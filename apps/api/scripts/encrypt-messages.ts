/**
 * Encrypt message bodies that were written before encryption existed.
 *
 *   npm run encrypt:messages --workspace=apps/api            # report what would change
 *   npm run encrypt:messages --workspace=apps/api -- --apply # do it
 *
 * The application reads both eras, so this is not required for anything to work — an unencrypted
 * row keeps opening exactly as it did. It is required for the old rows to actually be protected,
 * which is the whole point: without it, encryption applies only to messages sent from now on and a
 * database dump still hands over the entire history.
 *
 * Safe to re-run. Rows already encrypted are skipped, so an interrupted run is resumed by starting
 * it again rather than by working out where it stopped.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { encryptMessage, isEncryptionEnabled } from '../src/common/message-cipher.ts';
import { supabaseRootCa } from '../src/database/supabase-ca.ts';

config();

const APPLY = process.argv.includes('--apply');
const BATCH = 500;

/** The version byte a row written by message-cipher.ts starts with. */
const ENCRYPTED_MARKER = 0x01;

async function main() {
  if (!isEncryptionEnabled()) {
    console.error('\nMESSAGE_ENCRYPTION_KEY is not set. Nothing to encrypt *with*.\n');
    console.error('Generate one:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Neither DIRECT_URL nor DATABASE_URL is set');

  const ca = supabaseRootCa();
  if (!ca) throw new Error('Supabase CA certificate not found (expected apps/api/certs/…)');

  const url = new URL(databaseUrl);
  const pool = new Pool({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { ca, rejectUnauthorized: true },
    max: 1,
  });

  try {
    const { rows: [{ total, plain }] } = await pool.query<{ total: string; plain: string }>(`
      SELECT count(*) AS total,
             count(*) FILTER (
               WHERE octet_length(ciphertext) > 0 AND get_byte(ciphertext, 0) <> ${ENCRYPTED_MARKER}
             ) AS plain
      FROM messages`);

    console.log(`\n  ${total} messages, ${plain} of them unencrypted.\n`);
    if (Number(plain) === 0) {
      console.log('  Nothing to do.\n');
      return;
    }
    if (!APPLY) {
      console.log('  This was a dry run. Re-run with --apply to encrypt them.\n');
      return;
    }

    let done = 0;
    for (;;) {
      // Selected fresh each round rather than paged by offset: rows leave the set as they are
      // encrypted, so an offset would step over the ones that shuffled into its place.
      const { rows } = await pool.query<{ id: string; ciphertext: Buffer }>(`
        SELECT id, ciphertext FROM messages
        WHERE octet_length(ciphertext) > 0 AND get_byte(ciphertext, 0) <> ${ENCRYPTED_MARKER}
        LIMIT ${BATCH}`);
      if (rows.length === 0) break;

      // One transaction per batch. An interrupted run leaves whole batches done and the rest
      // untouched, never a half-written row.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of rows) {
          const text = Buffer.from(row.ciphertext).toString('utf8');
          await client.query('UPDATE messages SET ciphertext = $1 WHERE id = $2', [encryptMessage(text), row.id]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      done += rows.length;
      process.stdout.write(`\r  encrypted ${done} / ${plain}`);
    }
    console.log(`\n\n  Done. ${done} messages encrypted.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
