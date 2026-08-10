import { Injectable, ForbiddenException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Single source of truth for "is this account still allowed to act?".
 *
 * Both entry points need it and they used to disagree: JwtAuthGuard checked the block list on
 * every HTTP request, while the WebSocket handshake verified only the JWT signature — so
 * disabling an account cut off HTTP but left realtime access working until the token expired.
 */
@Injectable()
export class AccountStatusService {
  // In-process cache: userId → expiry timestamp. Avoids a Redis round-trip per request for
  // active users. Short TTL so a disable propagates quickly even without an explicit evict.
  private readonly activeCache = new Map<string, number>();
  /** userId → { role, expires }. Same short TTL, for the same reason. */
  private readonly roleCache = new Map<string, { role: string; expires: number }>();
  private static readonly CACHE_TTL_MS = 30_000;

  /** Emits 'disabled' with the userId, so live sockets can be dropped instead of lingering. */
  readonly events = new EventEmitter();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Forget every cached decision about a user — call after changing their status or role. */
  evict(userId: string) {
    this.activeCache.delete(userId);
    this.roleCache.delete(userId);
  }

  /**
   * The role the account has now, rather than the one its token was issued with.
   *
   * RolesGuard used to read the role straight from the JWT, which meant demoting an administrator
   * did not take effect until their token expired — up to eight hours of access they no longer
   * had. The same problem disabling an account had, solved the same way: read the truth, cache it
   * briefly, and evict on change.
   *
   * Null when the account cannot be read at all, so an unknown user is refused rather than
   * inheriting whatever their token claimed.
   */
  async currentRole(userId: string): Promise<string | null> {
    const cached = this.roleCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.role;

    const row = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!row) return null;

    this.roleCache.set(userId, { role: row.role, expires: Date.now() + AccountStatusService.CACHE_TTL_MS });
    return row.role;
  }

  /** Announce that a user was disabled so connected sockets can be closed immediately. */
  announceDisabled(userId: string) {
    this.evict(userId);
    this.events.emit('disabled', userId);
  }

  /**
   * True when the account may continue to act. Falls back to the database if Redis is
   * unreachable rather than failing open.
   */
  async isActive(userId: string): Promise<boolean> {
    const cached = this.activeCache.get(userId);
    if (cached && cached > Date.now()) return true;

    try {
      const blocked = await this.redis.get(`disabled:user:${userId}`);
      if (blocked) {
        this.activeCache.delete(userId);
        return false;
      }
    } catch {
      const row = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { status: true },
      });
      if (row?.status !== 'active') {
        this.activeCache.delete(userId);
        return false;
      }
    }

    this.activeCache.set(userId, Date.now() + AccountStatusService.CACHE_TTL_MS);
    return true;
  }

  /** Throwing variant for HTTP request handling. */
  async assertActive(userId: string): Promise<void> {
    if (!(await this.isActive(userId))) {
      throw new ForbiddenException('Account is disabled');
    }
  }
}
