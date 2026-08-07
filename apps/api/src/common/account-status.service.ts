import { Injectable, ForbiddenException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { RedisService } from '../redis/redis.service';
import { DatabaseService } from '../database/database.service';

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
  private static readonly CACHE_TTL_MS = 30_000;

  /** Emits 'disabled' with the userId, so live sockets can be dropped instead of lingering. */
  readonly events = new EventEmitter();

  constructor(
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
  ) {}

  /** Forget a cached decision — call after changing an account's status. */
  evict(userId: string) {
    this.activeCache.delete(userId);
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
      const r = await this.db.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1',
        [userId],
      );
      if (r.rows[0]?.status !== 'active') {
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
