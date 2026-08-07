import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Read directly rather than via prisma's env() helper, which throws at config-load time when the
// variable is absent. Only migrate and db pull need a connection; `prisma generate` does not, and
// CI runs generate without database credentials. The placeholder keeps generate working while
// making a missing DIRECT_URL fail loudly at connect time rather than silently pointing somewhere.
const MIGRATION_URL =
  process.env.DIRECT_URL ?? 'postgresql://DIRECT_URL-is-not-set/invalid';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Introspection and migrations must not go through pgbouncer — it cannot carry the
    // advisory locks and prepared statements Migrate relies on. DIRECT_URL is Supabase's
    // unpooled endpoint on :5432, which is exactly what this variable was always for.
    url: MIGRATION_URL,
  },
  migrations: {
    path: 'prisma/migrations',
  },
});
