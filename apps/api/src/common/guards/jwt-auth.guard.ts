import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RedisService } from '../../redis/redis.service';
import { DatabaseService } from '../../database/database.service';

// In-process cache: userId → expiry timestamp
// Avoids a remote Redis round-trip on every request for active users.
// TTL is short (30 s) so a disable propagates quickly.
const activeCache = new Map<string, number>();
const ACTIVE_CACHE_TTL_MS = 30_000;

export function evictActiveUser(userId: string) {
  activeCache.delete(userId);
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const can = await super.canActivate(context);
    if (!can) return false;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; scope?: string };

    // Reject TOTP-pending tokens on fully-authenticated routes
    if (user.scope === 'totp_pending') {
      throw new UnauthorizedException('Complete TOTP verification first');
    }

    // Fast path: recently confirmed active — skip remote call
    const cached = activeCache.get(user.id);
    if (cached && cached > Date.now()) return true;

    // Check Redis block list — fall back to DB if Redis is unavailable
    try {
      const blocked = await this.redis.get(`disabled:user:${user.id}`);
      if (blocked) {
        activeCache.delete(user.id);
        throw new ForbiddenException('Account is disabled');
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Redis down — confirm account status via DB rather than failing open
      const r = await this.db.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1',
        [user.id],
      );
      if (r.rows[0]?.status !== 'active') {
        activeCache.delete(user.id);
        throw new ForbiddenException('Account is disabled');
      }
    }

    activeCache.set(user.id, Date.now() + ACTIVE_CACHE_TTL_MS);
    return true;
  }

  handleRequest<T>(err: Error | null, user: T): T {
    if (err || !user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }
}
