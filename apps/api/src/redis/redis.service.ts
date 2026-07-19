import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis(this.config.get<string>('REDIS_URL')!, {
      tls: { rejectUnauthorized: false },
      lazyConnect: true,
    });
    this.client.ping().catch((err: Error) => {
      console.warn('[redis] ping failed on startup:', err.message);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
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
