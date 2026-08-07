import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Introspection and migrations must not go through pgbouncer — it cannot carry the
    // advisory locks and prepared statements Migrate relies on. DIRECT_URL is Supabase's
    // unpooled endpoint on :5432, which is exactly what this variable was always for.
    url: env('DIRECT_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
  },
});
