import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { supabaseRootCa } from './supabase-ca';

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
    const ca = supabaseRootCa();
    if (!ca) {
      // Failing closed: this connection carries password hashes, TOTP secrets and message bodies
      // across the public internet, so it must not silently fall back to an unverified channel.
      throw new Error(
        `Supabase CA certificate not found (expected apps/api/certs/supabase-prod-ca-2021.crt). ` +
          `Refusing to open an unverified TLS connection to ${url.hostname}.`,
      );
    }

    const pool = new Pool({
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      // Verified against Supabase's pinned root; see supabase-ca.ts for how it was obtained.
      ssl: { ca, rejectUnauthorized: true },
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
