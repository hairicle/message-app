import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client?: Redis;
  private readonly logger = new Logger(RedisService.name);
  /** Connections handed out by `duplicate`, closed with the service. */
  private readonly extra: Redis[] = [];

  constructor(private config: ConfigService) {}

  /**
   * Settings shared by every connection this service opens.
   *
   * `retryStrategy` is what lets the API rejoin Redis by itself once it comes back, rather than
   * needing a restart, and every connection needs it — not just the first one.
   */
  private connectionOptions(lazy: boolean) {
    return {
      // Upstash serves a publicly-trusted certificate, so the system trust store is enough — no
      // pinned CA needed here, unlike Postgres. This previously accepted any certificate, which
      // left the session block list open to tampering by anyone on the network path.
      tls: { rejectUnauthorized: true },
      lazyConnect: lazy,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 10_000),
    };
  }

  /**
   * Attaches the error handler every connection here must have.
   *
   * Without a listener, ioredis emits 'error' on an EventEmitter that has none — which Node treats
   * as fatal. A DNS failure lasting a few seconds took the whole API down, and it stayed down
   * after the network returned.
   */
  private guard(client: Redis, label: string, onError: (message: string) => void): Redis {
    let lastLoggedAt = 0;
    client.on('error', (err: Error) => {
      const now = Date.now();
      if (now - lastLoggedAt < 30_000) return;
      lastLoggedAt = now;
      onError(err.message);
    });
    client.on('ready', () => this.logger.log(`Redis connected (${label})`));
    return client;
  }

  /**
   * The shared connection, opened on first use rather than in `onModuleInit`.
   *
   * Lifecycle hooks run when the application is initialised, which happens inside `listen()` — but
   * the Socket.IO adapter is built in `bootstrap` before that, and asked this service for a
   * connection while `onModuleInit` had not yet run. Creating on demand removes the ordering
   * question rather than answering it, and the answer would have had to be rediscovered by whoever
   * next needed Redis early.
   */
  private get connection(): Redis {
    if (!this.client) {
      this.client = this.guard(
        new Redis(this.config.get<string>('REDIS_URL')!, this.connectionOptions(true)),
        'main',
        (message) => {
          this.logger.warn(`Redis unavailable: ${message}. Retrying; account checks fall back to the database.`);
        },
      );
    }
    return this.client;
  }

  onModuleInit() {
    this.connection.ping().catch((err: Error) => {
      this.logger.warn(`Redis ping failed on startup: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    // quit() rejects if the connection is already gone, which would fail shutdown for a reason
    // that does not matter at shutdown.
    const open = [this.client, ...this.extra].filter((c): c is Redis => !!c);
    await Promise.all(open.map((c) => c.quit().catch(() => undefined)));
  }


  /**
   * A second connection sharing this one's settings.
   *
   * The Socket.IO adapter needs two of its own: a client in subscribe mode cannot issue ordinary
   * commands, so it cannot be the one the rest of the app uses for the block list and presence.
   * They are registered here so shutdown closes them too, and they inherit the same retry strategy
   * and error handling — a pub/sub connection that threw on a network blip would take the process
   * down exactly as the main one used to.
   */
  duplicate(label: string): Redis {
    const client = this.guard(
      new Redis(this.config.get<string>('REDIS_URL')!, this.connectionOptions(false)),
      label,
      (message) => this.logger.warn(`Redis (${label}) unavailable: ${message}. Retrying.`),
    );
    this.extra.push(client);
    return client;
  }

  get(key: string) {
    return this.connection.get(key);
  }

  set(key: string, value: string, mode?: 'EX', ttl?: number) {
    if (mode === 'EX' && ttl !== undefined) {
      return this.connection.set(key, value, 'EX', ttl);
    }
    return this.connection.set(key, value);
  }

  del(key: string) {
    return this.connection.del(key);
  }

  sadd(key: string, ...members: string[]) {
    return this.connection.sadd(key, ...members);
  }

  srem(key: string, ...members: string[]) {
    return this.connection.srem(key, ...members);
  }

  smembers(key: string) {
    return this.connection.smembers(key);
  }

  sismember(key: string, member: string) {
    return this.connection.sismember(key, member);
  }

  expire(key: string, seconds: number) {
    return this.connection.expire(key, seconds);
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.connection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  pipeline() {
    return this.connection.pipeline();
  }
}
