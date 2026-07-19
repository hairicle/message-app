import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly redis: RedisService) {
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

    // Check Redis block list — fail open if Redis is unavailable
    try {
      const blocked = await this.redis.get(`disabled:user:${user.id}`);
      if (blocked) throw new ForbiddenException('Account is disabled');
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Redis down — allow through
    }

    return true;
  }

  handleRequest<T>(err: Error | null, user: T): T {
    if (err || !user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }
}
