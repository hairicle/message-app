import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly logger = new Logger(RedisService.name);
  /** Stops a long outage writing one line per retry, several times a second. */
  private lastErrorLoggedAt = 0;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis(this.config.get<string>('REDIS_URL')!, {
      // Upstash serves a publicly-trusted certificate, so the system trust store is enough — no
      // pinned CA needed here, unlike Postgres. This previously accepted any certificate, which
      // left the session block list open to tampering by anyone on the network path.
      tls: { rejectUnauthorized: true },
      lazyConnect: true,
      // Keeps trying, with a ceiling, so the API rejoins Redis by itself once it comes back
      // rather than needing a restart.
      retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
    });

    /**
     * Without a listener here, ioredis emits 'error' on an EventEmitter that has none — which
     * Node treats as fatal. A DNS failure lasting a few seconds took the whole API down, and it
     * stayed down after the network returned.
     */
    this.client.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt < 30_000) return;
      this.lastErrorLoggedAt = now;
      this.logger.warn(`Redis unavailable: ${err.message}. Retrying; account checks fall back to the database.`);
    });

    this.client.on('ready', () => this.logger.log('Redis connected'));

    this.client.ping().catch((err: Error) => {
      this.logger.warn(`Redis ping failed on startup: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    // quit() rejects if the connection is already gone, which would fail shutdown for a reason
    // that does not matter at shutdown.
    await this.client.quit().catch(() => undefined);
  }

  get(key: string) {
    return this.client.get(key);
  }

  set(key: string, value: string, mode?: 'EX', ttl?: number) {
    if (mode === 'EX' && ttl !== undefined) {
      return this.client.set(key, value, 'EX', ttl);
    }
    return this.client.set(key, value);
  }

  del(key: string) {
    return this.client.del(key);
  }

  sadd(key: string, ...members: string[]) {
    return this.client.sadd(key, ...members);
  }

  srem(key: string, ...members: string[]) {
    return this.client.srem(key, ...members);
  }

  smembers(key: string) {
    return this.client.smembers(key);
  }

  sismember(key: string, member: string) {
    return this.client.sismember(key, member);
  }

  expire(key: string, seconds: number) {
    return this.client.expire(key, seconds);
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  pipeline() {
    return this.client.pipeline();
  }
}
