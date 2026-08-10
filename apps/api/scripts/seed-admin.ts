/**
 * Create the first administrator, so a fresh database can be logged into.
 *
 * The NestJS refactor dropped the old seed and nothing replaced it, which left a newly-created
 * environment with no way in at all — the staging walkthrough had to tell people to write a
 * bcrypt hash by hand and INSERT it.
 *
 *   npm run seed:admin --workspace=apps/api
 *
 * Reads SEED_ADMIN_EMAIL, SEED_ADMIN_USERNAME, SEED_ADMIN_NAME and SEED_ADMIN_PASSWORD from the
 * environment. Anything not given is defaulted, except the password: when none is supplied a
 * strong one is generated and printed once. It is never defaulted to something guessable, because
 * the first account on a system is an administrator and a known default password on an
 * internet-reachable deployment is the same thing as no password.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { config } from 'dotenv';
import { supabaseRootCa } from '../src/database/supabase-ca.ts';

config();

const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@company.local';
const USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';
/** Whether the caller named the account, or is taking the defaults. */
const NAMED_EXPLICITLY = !!(process.env.SEED_ADMIN_EMAIL || process.env.SEED_ADMIN_USERNAME);
const DISPLAY_NAME = process.env.SEED_ADMIN_NAME ?? 'Administrator';

/**
 * A password a person can retype if they have to, without being weak: five random words from a
 * random-ish alphabet is unmemorable, and a printed line that cannot be typed accurately gets
 * pasted into a chat message instead.
 */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(randomBytes(20)).map((b) => alphabet[b % alphabet.length]);
  // A digit and a symbol regardless of the draw, so it satisfies a policy that demands them.
  chars[randomInt(chars.length)] = String(randomInt(10));
  chars[randomInt(chars.length)] = '!';
  return chars.join('');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const ca = supabaseRootCa();
  if (!ca) {
    // The same rule the running API applies: this connection carries a password hash, so it must
    // not fall back to an unverified channel.
    throw new Error('Supabase CA certificate not found (expected apps/api/certs/supabase-prod-ca-2021.crt)');
  }

  const url = new URL(databaseUrl);
  const pool = new Pool({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { ca, rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Refuses rather than overwrites. Re-running this on a live system must not reset the
    // password of an account people are already using.
    const existing = await prisma.users.findFirst({
      where: { OR: [{ email: EMAIL }, { username: USERNAME }] },
      select: { id: true, email: true, username: true, role: true },
    });
    if (existing) {
      console.log(`An account already exists (${existing.email} / @${existing.username}, ${existing.role}).`);
      console.log('Nothing was changed. Set SEED_ADMIN_EMAIL and SEED_ADMIN_USERNAME to create a different one.');
      return;
    }

    // Guards against re-running the seed on a populated database and quietly adding a second
    // administrator. Skipped when the caller named the account, since doing so is how you say you
    // meant it — without this the advice printed below was impossible to act on.
    if (!NAMED_EXPLICITLY) {
      const anyAdmin = await prisma.users.findFirst({ where: { role: 'admin' }, select: { email: true } });
      if (anyAdmin) {
        console.log(`This database already has an administrator (${anyAdmin.email}).`);
        console.log('Nothing was changed. Set SEED_ADMIN_EMAIL and SEED_ADMIN_USERNAME if you meant to add another.');
        return;
      }
    }

    const supplied = process.env.SEED_ADMIN_PASSWORD;
    const password = supplied ?? generatePassword();
    // Cost 12, matching the application's own hashing, so this account is no weaker than one
    // created through the admin screens.
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.users.create({
      data: {
        email: EMAIL,
        username: USERNAME,
        display_name: DISPLAY_NAME,
        password_hash: passwordHash,
        role: 'admin',
        status: 'active',
      },
      select: { id: true },
    });

    console.log('\nAdministrator created.\n');
    console.log(`  email     ${EMAIL}`);
    console.log(`  username  ${USERNAME}`);
    if (supplied) {
      console.log('  password  (the one you supplied)');
    } else {
      console.log(`  password  ${password}`);
      console.log('\nThis is the only time it is shown. Sign in and change it.');
    }
    console.log(`\n  id        ${user.id}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nSeeding failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
