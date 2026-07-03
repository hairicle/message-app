import { Pool } from 'pg';
import { env } from './env.js';

// pg drops the Supabase project-ref from usernames (postgres.xxx → postgres).
// WHATWG URL API preserves the full username correctly.
function makePool(url: string): Pool {
  const u = new URL(url);
  const needsSsl =
    url.includes('supabase.com') ||
    url.includes('neon.tech') ||
    url.includes('sslmode=require');

  return new Pool({
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    database: u.pathname.replace(/^\//, ''),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

export const db = makePool(env.databaseUrl);
