/**
 * Performance and latency measurement against the running API.
 *
 *   npm run test:perf --workspace=apps/api
 *
 * Third in the set, after security-test.mjs and file-handling-test.mjs. Those ask whether the
 * system is correct; this one asks whether it is quick enough, and where the time goes when it is
 * not. Creates its own accounts and data, and deletes all of it in `finally`.
 *
 * Numbers from a developer machine talking to a Supabase instance in another region are not
 * production numbers. What travels is the *shape*: which operations are constant and which grow,
 * and where a round trip is being paid more than once.
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import { io } from 'socket.io-client';

config();

const API = 'http://localhost:4000';
const PW = 'PerfHarness!2026';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: readFileSync('./certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true },
  max: 10,
});

async function api(token, path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers, redirect: 'manual' });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, bytes: text.length };
}

function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`); }

/** Percentiles say more than an average: one slow request in fifty is what people notice. */
function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    n: s.length,
    min: s[0],
    p50: at(50),
    p95: at(95),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

const ms = (n) => `${n.toFixed(0)}ms`;

function report(label, samples, extra = '') {
  const t = stats(samples);
  console.log(
    `  ${label.padEnd(42)} p50 ${ms(t.p50).padStart(7)}   p95 ${ms(t.p95).padStart(7)}`
    + `   max ${ms(t.max).padStart(7)}   n=${t.n}${extra ? `   ${extra}` : ''}`,
  );
  return t;
}

async function time(fn) {
  const t0 = performance.now();
  const out = await fn();
  return { ms: performance.now() - t0, out };
}

/** Repeat, discarding the first few so a cold path is not reported as the steady state. */
async function measure(times, fn, warmup = 3) {
  for (let i = 0; i < warmup; i += 1) await fn();
  const samples = [];
  for (let i = 0; i < times; i += 1) samples.push((await time(fn)).ms);
  return samples;
}

const made = { users: [], convs: [] };
let seq = 0;

async function mkUser(tag) {
  const u = `${tag}${seq++}`;
  const hash = await bcrypt.hash(PW, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, role, status)
     VALUES ($1,$2,$3,$4,'staff','active') RETURNING id`,
    [`pf-${u}@harness.local`, `pf_${u}`, `PF ${u}`, hash],
  );
  made.users.push(rows[0].id);
  const token = (await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: `pf-${u}@harness.local`, password: PW }),
  })).body?.token;
  return { id: rows[0].id, token, email: `pf-${u}@harness.local` };
}

/** Messages written straight to the database — far quicker than sending them through the API. */
async function seedMessages(convId, senderId, count) {
  const rows = [];
  const params = [];
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    rows.push(`($${base + 1}, $${base + 2}, 'text', $${base + 3}, $${base + 4})`);
    params.push(
      convId, senderId,
      Buffer.from(Buffer.from(`seeded message number ${i} with a little body text`).toString('base64')),
      new Date(Date.now() - (count - i) * 1000),
    );
  }
  // Chunked: one statement with 20,000 parameters is its own performance problem.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const offset = i * 4;
    const renumbered = slice.map((_, j) => {
      const b = j * 4;
      return `($${b + 1}, $${b + 2}, 'text', $${b + 3}, $${b + 4})`;
    });
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, type, ciphertext, created_at) VALUES ${renumbered.join(',')}`,
      params.slice(offset, offset + slice.length * 4),
    );
  }
}

async function main() {
  const findings = [];

  const alice = await mkUser('alice');
  const bob = await mkUser('bob');

  // ── 1 ─────────────────────────────────────────────────────────────────────
  section('1. Baseline round trips');

  report('GET /health (no auth, no database)', await measure(30, () => api(null, '/health')));
  report('GET /api/auth/me (auth only)', await measure(30, () => api(alice.token, '/api/auth/me')));
  report('GET /api/users/directory', await measure(20, () => api(alice.token, '/api/users/directory')));
  report('GET /api/conversations (empty)', await measure(20, () => api(alice.token, '/api/conversations')));

  // ── 2 ─────────────────────────────────────────────────────────────────────
  section('2. Sign-in');

  // Deliberately few: bcrypt at cost 12 is meant to be slow, and the login route is rate limited.
  const loginSamples = await measure(5, () => api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: bob.email, password: PW }),
  }), 1);
  const login = report('POST /api/auth/login (bcrypt cost 12)', loginSamples);
  console.log(`        bcrypt is intentionally slow; this is the cost of a password check, not a fault`);
  if (login.p50 > 1500) findings.push(`Sign-in takes ${ms(login.p50)} at the median — worth checking the bcrypt cost.`);

  // ── 3 ─────────────────────────────────────────────────────────────────────
  section('3. Reading a thread as it grows');

  const conv = (await api(alice.token, '/api/conversations', {
    method: 'POST', body: JSON.stringify({ type: 'direct', memberIds: [bob.id] }),
  })).body.conversation;
  made.convs.push(conv.id);

  const growth = [];
  let seeded = 0;
  for (const size of [100, 1000, 5000, 20000]) {
    await seedMessages(conv.id, alice.id, size - seeded);
    seeded = size;
    const samples = await measure(10, () => api(alice.token, `/api/messages?conversationId=${conv.id}&limit=50`));
    const one = await api(alice.token, `/api/messages?conversationId=${conv.id}&limit=50`);
    const t = report(`GET 50 messages from a thread of ${String(size).padStart(6)}`, samples,
      `${(one.bytes / 1024).toFixed(0)} KB`);
    growth.push({ size, p50: t.p50 });
  }
  const first = growth[0].p50;
  const last = growth[growth.length - 1].p50;
  console.log(`\n        a page is ${last > first * 2 ? 'GROWING with the thread' : 'flat as the thread grows'}`
    + ` — ${ms(first)} at 100 messages, ${ms(last)} at 20,000`);
  if (last > first * 2) findings.push('Reading a page of messages grows with the size of the thread — the index is not carrying the query.');

  // Paging backwards is what scrolling up does, repeatedly.
  const page1 = (await api(alice.token, `/api/messages?conversationId=${conv.id}&limit=50`)).body.messages;
  const cursor = page1[0]?.id;
  report('GET the page before (scrolling up)', await measure(10, () =>
    api(alice.token, `/api/messages?conversationId=${conv.id}&limit=50&before=${cursor}`)));

  // ── 4 ─────────────────────────────────────────────────────────────────────
  section('4. Search');

  const searchSamples = await measure(8, () => api(alice.token, `/api/messages/search?q=seeded&conversationId=${conv.id}`));
  const search = report('GET /api/messages/search in 20,000', searchSamples);
  console.log('        matching happens in Node, not SQL — the scan is capped at 4,000 rows');
  if (search.p50 > 1000) findings.push(`Search takes ${ms(search.p50)} at the median over a capped 4,000-row scan; it will not improve with more data, it is already truncated.`);

  const searchAll = await measure(5, () => api(alice.token, '/api/messages/search?q=seeded'));
  report('the same search across every conversation', searchAll);

  // ── 5 ─────────────────────────────────────────────────────────────────────
  section('5. The conversation list, as it fills');

  for (const n of [5, 25]) {
    while (made.convs.length < n + 1) {
      const c = (await api(alice.token, '/api/conversations', {
        method: 'POST', body: JSON.stringify({ type: 'group', name: `Perf ${made.convs.length}`, memberIds: [bob.id, (await mkUser('m')).id] }),
      })).body.conversation;
      if (c) made.convs.push(c.id);
    }
    report(`GET /api/conversations with ${String(n).padStart(3)} conversations`,
      await measure(10, () => api(alice.token, '/api/conversations')));
  }

  // ── 6 ─────────────────────────────────────────────────────────────────────
  section('6. Sending, and how quickly it arrives');

  const sendSamples = await measure(15, () => api(alice.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify({ conversationId: conv.id, type: 'text', ciphertext: Buffer.from('perf').toString('base64') }),
  }));
  report('POST /api/messages (write path)', sendSamples);

  const sA = await new Promise((res, rej) => {
    const s = io(API, { auth: { token: alice.token }, transports: ['websocket'] });
    s.on('connect', () => res(s)); s.on('connect_error', rej);
  });
  const sB = await new Promise((res, rej) => {
    const s = io(API, { auth: { token: bob.token }, transports: ['websocket'] });
    s.on('connect', () => res(s)); s.on('connect_error', rej);
  });
  // Let the room joins settle; they are awaited after the handshake resolves.
  await new Promise((r) => setTimeout(r, 1500));

  const deliveries = [];
  for (let i = 0; i < 12; i += 1) {
    const t0 = performance.now();
    const arrived = new Promise((r) => { sB.once('message:new', () => r(performance.now() - t0)); });
    sA.emit('message:send', { conversationId: conv.id, type: 'text', ciphertext: Buffer.from(`rt-${i}`).toString('base64') });
    deliveries.push(await Promise.race([arrived, new Promise((r) => setTimeout(() => r(NaN), 8000))]));
  }
  const rt = report('socket send → other client receives', deliveries.filter((d) => !Number.isNaN(d)));
  if (rt.p50 > 500) findings.push(`Realtime delivery is ${ms(rt.p50)} at the median — above the ~200ms where a chat stops feeling live.`);

  sA.close(); sB.close();

  // ── 7 ─────────────────────────────────────────────────────────────────────
  section('7. Under concurrent load');

  for (const concurrency of [1, 10, 30]) {
    const t0 = performance.now();
    const batch = await Promise.all(
      Array.from({ length: concurrency * 5 }, () => api(alice.token, `/api/messages?conversationId=${conv.id}&limit=50`)),
    );
    const elapsed = performance.now() - t0;
    const throttled = batch.filter((b) => b.status === 429).length;
    const failed = batch.filter((b) => b.status >= 500).length;
    console.log(`  ${String(concurrency * 5).padStart(3)} requests, ${String(concurrency).padStart(2)} at a time`
      + `   ${ms(elapsed).padStart(8)} total   ${ms(elapsed / (concurrency * 5)).padStart(7)} each`
      + `   ${throttled} throttled, ${failed} failed`);
    if (failed > 0) findings.push(`${failed} requests failed with 5xx at a concurrency of ${concurrency}.`);
  }

  // ── 8 ─────────────────────────────────────────────────────────────────────
  section('8. Attachments');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const sharp = (await import('sharp')).default;
  const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3b82f6' } })
    .jpeg({ quality: 90 }).toBuffer();

  const uploadOne = async (bytes, type, name) => {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name);
    const r = await fetch(`${API}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: fd });
    const b = await r.json().catch(() => null);
    if (b?.file?.id) await pool.query('DELETE FROM files WHERE id=$1', [b.file.id]).catch(() => {});
    return b;
  };

  report('POST /api/files — 1x1 png (no preview work)', await measure(6, () => uploadOne(png, 'image/png', 't.png'), 1));
  const photoSamples = await measure(6, () => uploadOne(photo, 'image/jpeg', 'p.jpg'), 1);
  const photoT = report('POST /api/files — a 3000x2000 photo', photoSamples, `${(photo.length / 1024).toFixed(0)} KB`);
  console.log('        includes generating the 1280px preview and two uploads to storage');
  if (photoT.p50 > 4000) findings.push(`Uploading a normal photo takes ${ms(photoT.p50)} at the median.`);

  // ── summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(76)}`);
  if (findings.length === 0) {
    console.log('  Nothing measured outside the range this test considers acceptable.');
  } else {
    console.log('  WORTH ATTENTION:');
    for (const f of findings) console.log(`    · ${f}`);
  }
  console.log('═'.repeat(76));
}

try {
  await main();
} catch (err) {
  console.error('\nHARNESS ERROR:', err?.message ?? err, err?.stack?.split('\n')[1] ?? '');
} finally {
  for (const id of made.convs) await pool.query('DELETE FROM conversations WHERE id=$1', [id]).catch(() => {});
  for (const id of made.users) {
    await pool.query('DELETE FROM messages WHERE sender_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM files WHERE uploader_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
  }
  const left = await pool.query("SELECT count(*)::int n FROM users WHERE email LIKE 'pf-%@harness.local'");
  await pool.end();
  console.log(`\n  cleaned up (${left.rows[0].n} harness accounts left behind)`);
  process.exit(0);
}
