import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Prisma Client wired to the same pooled Supabase connection the raw pg layer used.
 *
 * Prisma 7 no longer takes a connection URL in schema.prisma — the runtime client is built from
 * a driver adapter, so the pool below is the single place connection settings are defined.
 * Migrations and introspection use DIRECT_URL instead (see prisma.config.ts): pgbouncer cannot
 * carry the advisory locks Migrate needs.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const url = new URL(config.get<string>('DATABASE_URL')!);
    const pool = new Pool({
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      // TODO: pin the Supabase CA and turn verification back on — the pooler presents a
      // self-signed chain, so this currently accepts any certificate.
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    super({ adapter: new PrismaPg(pool) });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    PrismaService.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
