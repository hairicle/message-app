import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const url = new URL(this.config.get<string>('DATABASE_URL')!);
    this.pool = new Pool({
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }
}
