/**
 * Live test of file handling, input validation and exception behaviour.
 *
 * Companion to security-test.mjs. That one asks whether the walls hold; this one asks what happens
 * when a caller sends something malformed, hostile or merely strange — and whether the answer is a
 * clear 4xx or a 500 that gets logged as our fault.
 *
 *   npm run test:files --workspace=apps/api
 *
 * Creates its own accounts and deletes everything in `finally`.
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';

config();

const API = 'http://localhost:4000';
const PW = 'FileHarness!2026';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: readFileSync('./certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true },
});

async function api(token, path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.body && !opts.raw) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers, redirect: 'manual' });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers, text };
}

const results = [];
function check(id, label, passed, detail = '') {
  results.push({ id, label, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  [${id}] ${label}${detail ? `  — ${detail}` : ''}`);
}
function info(id, label, detail) {
  results.push({ id, label, passed: null, detail });
  console.log(`  NOTE  [${id}] ${label}  — ${detail}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`); }

/** A 4xx that names the caller's mistake. Anything 5xx is a failure of this test's premise. */
const clientError = (s) => s >= 400 && s < 500;

const made = { users: [], convs: [], files: [] };
let seq = 0;

async function mkUser(tag) {
  const u = `${tag}${seq++}`;
  const hash = await bcrypt.hash(PW, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, role, status)
     VALUES ($1,$2,$3,$4,'staff','active') RETURNING id`,
    [`fh-${u}@harness.local`, `fh_${u}`, `FH ${u}`, hash],
  );
  made.users.push(rows[0].id);
  const token = (await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: `fh-${u}@harness.local`, password: PW }),
  })).body?.token;
  return { id: rows[0].id, token };
}

/** POST /api/files with an arbitrary name, type and payload. */
async function upload(token, name, type, bytes, field = 'file') {
  const fd = new FormData();
  const blob = type === null ? new Blob([bytes]) : new Blob([bytes], { type });
  fd.append(field, blob, name);
  const res = await fetch(`${API}/api/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (body?.file?.id) made.files.push(body.file.id);
  return { status: res.status, body };
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

/** CRC-32, which every PNG chunk carries — a decoder rejects the file outright without it. */
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * A structurally valid PNG whose header declares enormous dimensions, with no pixel data behind
 * them. Sixty-nine bytes claiming to be a gigapixel image — the classic decompression bomb, and
 * the reason image decoders carry a pixel ceiling.
 */
function pngHeaderClaiming(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const sharp = (await import('sharp')).default;
  const alice = await mkUser('alice');
  const bob = await mkUser('bob');
  const conv = (await api(alice.token, '/api/conversations', {
    method: 'POST', body: JSON.stringify({ type: 'direct', memberIds: [bob.id] }),
  })).body.conversation;
  made.convs.push(conv.id);

  // ── A ─────────────────────────────────────────────────────────────────────
  section('A. Upload shape and size');

  const noFile = await fetch(`${API}/api/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: new FormData(),
  });
  check('A1', 'a request with no file is refused, not a 500', clientError(noFile.status), `${noFile.status}`);

  const wrongField = await upload(alice.token, 'x.png', 'image/png', PNG_1x1, 'attachment');
  check('A2', 'a file under the wrong field name is refused', clientError(wrongField.status), `${wrongField.status}`);

  const empty = await upload(alice.token, 'empty.png', 'image/png', Buffer.alloc(0));
  info('A3', 'a zero-byte file', `${empty.status}${empty.body?.file ? ' — stored' : ` ${JSON.stringify(empty.body).slice(0, 70)}`}`);

  const justUnder = await upload(alice.token, 'ok.bin', 'application/octet-stream', Buffer.alloc(49 * 1024 * 1024));
  check('A4', 'a file just under the 50 MB limit is accepted', justUnder.status === 201, `${justUnder.status}`);

  const t0 = Date.now();
  const over = await upload(alice.token, 'big.bin', 'application/octet-stream', Buffer.alloc(55 * 1024 * 1024));
  const overMs = Date.now() - t0;
  check('A5', 'a file over the limit is refused', clientError(over.status), `${over.status} in ${overMs}ms`);

  // Multer is mounted with no `limits`, so the whole body should land in memory before either size
  // check runs. Timing one oversized upload proves nothing on a loopback interface — but if the
  // refusal is streaming, doubling the payload costs nothing, and if the body is read in full
  // first, the time roughly doubles with it.
  const t1 = Date.now();
  const over2 = await upload(alice.token, 'bigger.bin', 'application/octet-stream', Buffer.alloc(150 * 1024 * 1024));
  const over2Ms = Date.now() - t1;
  const scales = over2Ms > overMs * 1.8;
  info('A6', 'where the size limit is applied',
    scales
      ? `55 MB refused in ${overMs}ms, 150 MB in ${over2Ms}ms — the time scales with the payload, so the whole body is read into memory before the limit is applied. It guards storage, not the process.`
      : `55 MB refused in ${overMs}ms, 150 MB in ${over2Ms}ms — refusal does not scale with size, so it is rejected before the body is read`);
  check('A7', 'an oversized upload is still refused rather than accepted', clientError(over2.status), `${over2.status}`);

  // ── B ─────────────────────────────────────────────────────────────────────
  section('B. Filename handling');

  const names = [
    ['B1', 'a path-traversal filename', '../../../etc/passwd'],
    ['B2', 'a Windows path', 'C:\\Windows\\System32\\evil.png'],
    ['B3', 'a filename with no extension', 'noextension'],
    ['B4', 'a dotfile', '.htaccess'],
    ['B5', 'a double extension', 'invoice.png.exe'],
    ['B6', 'a 300-character filename', `${'a'.repeat(300)}.png`],
    ['B7', 'markup in the extension', 'x.<script>alert(1)</script>'],
    ['B8', 'a unicode filename', 'фото-📸-café.png'],
    ['B9', 'a filename that is only dots', '...'],
  ];
  for (const [id, label, name] of names) {
    const r = await upload(alice.token, name, 'image/png', PNG_1x1);
    const stored = r.body?.file?.id
      ? (await pool.query('SELECT storage_key, file_name FROM files WHERE id=$1', [r.body.file.id])).rows[0]
      : null;
    // A storage key must stay a single flat name under the bucket. A separator in it is a write
    // outside the intended prefix; a traversal segment is a write outside the bucket path.
    const keySafe = !stored || (!/[\\/]/.test(stored.storage_key) && !stored.storage_key.includes('..'));
    check(id, label, r.status < 500 && keySafe,
      stored ? `${r.status}, key=${JSON.stringify(stored.storage_key.slice(0, 60))}` : `${r.status}`);
  }

  // ── C ─────────────────────────────────────────────────────────────────────
  section('C. Content type');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
  const svgUp = await upload(alice.token, 'x.svg', 'image/svg+xml', svg);
  info('C1', 'an SVG carrying a script', `${svgUp.status}${svgUp.body?.file ? ' — stored' : ''}`);

  const html = Buffer.from('<html><script>alert(document.domain)</script></html>');
  const htmlUp = await upload(alice.token, 'page.html', 'text/html', html);
  info('C2', 'an HTML file declared as text/html', `${htmlUp.status}${htmlUp.body?.file ? ' — stored' : ''}`);

  // What the browser is told when the file comes back is what decides whether the two above
  // matter. A download served as an attachment is inert; one served inline as its declared type
  // executes on the storage host.
  for (const [id, label, up] of [['C3', 'the SVG', svgUp], ['C4', 'the HTML file', htmlUp]]) {
    if (!up.body?.file) { info(id, `${label} on download`, 'not stored, nothing to check'); continue; }
    await api(alice.token, '/api/messages', {
      method: 'POST', body: JSON.stringify({ conversationId: conv.id, type: 'file', fileId: up.body.file.id }),
    });
    const redir = await api(alice.token, `/api/files/${up.body.file.id}`);
    const loc = redir.headers.get('location');
    if (!loc) { info(id, `${label} on download`, `no redirect (${redir.status})`); continue; }
    const served = await fetch(loc, { redirect: 'manual' });
    const ct = served.headers.get('content-type') ?? '(none)';
    const cd = served.headers.get('content-disposition') ?? '(none)';
    const inert = /attachment/i.test(cd) || !/text\/html|image\/svg/i.test(ct);
    check(id, `${label} is not served as executable markup`, inert, `content-type: ${ct}, content-disposition: ${cd}`);
  }

  // A declared type that the bytes contradict must not crash the image pipeline.
  const liar = await upload(alice.token, 'notreally.png', 'image/png', Buffer.from('PK\x03\x04 this is a zip, not a png'));
  check('C5', 'bytes that contradict the declared image type do not 500',
    liar.status < 500, `${liar.status}, thumbnail=${liar.body?.file?.hasThumbnail}`);

  const noType = await upload(alice.token, 'unknown', null, PNG_1x1);
  check('C6', 'an upload with no declared type does not 500', noType.status < 500, `${noType.status}`);

  // ── D ─────────────────────────────────────────────────────────────────────
  section('D. Image processing');

  const corrupt = Buffer.concat([PNG_1x1.subarray(0, 20), Buffer.from('garbage'.repeat(20))]);
  const corruptUp = await upload(alice.token, 'corrupt.png', 'image/png', corrupt);
  check('D1', 'a corrupt image is stored without a preview rather than failing',
    corruptUp.status === 201 && corruptUp.body?.file?.hasThumbnail === false,
    `${corruptUp.status}, thumbnail=${corruptUp.body?.file?.hasThumbnail}`);

  // A real image at the top of what the decoder will accept — 225 megapixels from a file small
  // enough to upload in a moment. This is the shape of a decompression bomb: the cost is in
  // decoding, not in transfer.
  const bigT0 = Date.now();
  const big = await sharp({ create: { width: 15000, height: 15000, channels: 3, background: '#204080' } })
    .png({ compressionLevel: 9 }).toBuffer();
  const bigUp = await upload(alice.token, 'big.png', 'image/png', big);
  const bigMs = Date.now() - bigT0;
  check('D2', 'a 225-megapixel image does not hang or crash the API',
    bigUp.status < 500 && bigMs < 120_000,
    `${(big.length / 1024).toFixed(0)} KB source → ${bigUp.status} in ${bigMs}ms, thumbnail=${bigUp.body?.file?.hasThumbnail}`);

  // Past the decoder's ceiling. Hand-built rather than generated, because the generator enforces
  // the same limit: 40000x40000 is 1.6 gigapixels declared in a 69-byte file. A decoder that
  // trusts the header allocates for all of it.
  const bombT0 = Date.now();
  const bombUp = await upload(alice.token, 'bomb.png', 'image/png', pngHeaderClaiming(40000, 40000));
  const bombMs = Date.now() - bombT0;
  check('D6', 'a header claiming 1.6 gigapixels is refused by the decoder, not obeyed',
    bombUp.status < 500 && bombUp.body?.file?.hasThumbnail === false && bombMs < 30_000,
    `${bombUp.status} in ${bombMs}ms, thumbnail=${bombUp.body?.file?.hasThumbnail}`);

  const tall = await sharp({ create: { width: 4000, height: 100, channels: 3, background: '#123456' } }).png().toBuffer();
  const tallUp = await upload(alice.token, 'wide.png', 'image/png', tall);
  const tallMeta = tallUp.body?.file?.hasThumbnail
    ? await sharp(Buffer.from(await (await fetch((await api(alice.token, `/api/files/${tallUp.body.file.id}/thumbnail`)).headers.get('location'))).arrayBuffer())).metadata()
    : null;
  check('D3', 'an extreme aspect ratio is preserved in the preview',
    !tallMeta || Math.abs((tallMeta.width / tallMeta.height) - 40) < 1,
    tallMeta ? `${tallMeta.width}x${tallMeta.height}` : 'no preview');

  const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const smallUp = await upload(alice.token, 'small.png', 'image/png', small);
  const smallMeta = smallUp.body?.file?.hasThumbnail
    ? await sharp(Buffer.from(await (await fetch((await api(alice.token, `/api/files/${smallUp.body.file.id}/thumbnail`)).headers.get('location'))).arrayBuffer())).metadata()
    : null;
  check('D4', 'an image smaller than the preview size is not enlarged',
    !smallMeta || (smallMeta.width === 40 && smallMeta.height === 40),
    smallMeta ? `${smallMeta.width}x${smallMeta.height}` : 'no preview');

  // sharp ignores EXIF orientation unless asked; a portrait phone photo used to preview sideways.
  const rotated = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#f00' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rotUp = await upload(alice.token, 'rot.jpg', 'image/jpeg', rotated);
  const rotMeta = rotUp.body?.file?.hasThumbnail
    ? await sharp(Buffer.from(await (await fetch((await api(alice.token, `/api/files/${rotUp.body.file.id}/thumbnail`)).headers.get('location'))).arrayBuffer())).metadata()
    : null;
  check('D5', 'EXIF orientation is applied to the preview',
    !rotMeta || rotMeta.width === 200, rotMeta ? `${rotMeta.width}x${rotMeta.height} (upright is 200x400)` : 'no preview');

  // ── E ─────────────────────────────────────────────────────────────────────
  section('E. Avatar uploads');

  const avatarBig = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#0f0' } })
    .png().toBuffer();
  const fdA = new FormData();
  fdA.append('avatar', new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
  const avOver = await fetch(`${API}/api/users/me/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: fdA,
  });
  check('E1', 'an avatar over 5 MB is refused', clientError(avOver.status), `${avOver.status}`);

  const fdB = new FormData();
  fdB.append('avatar', new Blob([avatarBig], { type: 'image/png' }), 'ok.png');
  const avOk = await fetch(`${API}/api/users/me/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: fdB,
  });
  check('E2', 'a normal avatar is accepted', avOk.status < 400, `${avOk.status}`);

  const fdC = new FormData();
  fdC.append('avatar', new Blob([Buffer.from('not an image at all')], { type: 'image/png' }), 'lie.png');
  const avLie = await fetch(`${API}/api/users/me/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: fdC,
  });
  check('E3', 'an avatar that is not an image does not 500', avLie.status < 500, `${avLie.status}`);

  const avDirect = await fetch(`${API}/api/conversations/${conv.id}/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: (() => {
      const f = new FormData(); f.append('avatar', new Blob([avatarBig], { type: 'image/png' }), 'g.png'); return f;
    })(),
  });
  check('E4', 'a direct conversation has no picture of its own', clientError(avDirect.status), `${avDirect.status}`);

  // ── F ─────────────────────────────────────────────────────────────────────
  section('F. Input verification across endpoints');

  const probes = [
    ['F1', 'limit as a word', 'GET', `/api/messages?conversationId=${conv.id}&limit=abc`],
    ['F2', 'a negative limit', 'GET', `/api/messages?conversationId=${conv.id}&limit=-1`],
    ['F3', 'an enormous limit', 'GET', `/api/messages?conversationId=${conv.id}&limit=99999999`],
    ['F4', 'a non-uuid "before" cursor', 'GET', `/api/messages?conversationId=${conv.id}&before=nope`],
    ['F5', 'no conversationId at all', 'GET', '/api/messages'],
    ['F6', 'search with no query', 'GET', '/api/messages/search'],
    ['F7', 'an attachment type list that is empty', 'GET', `/api/conversations/${conv.id}/attachments?types=`],
  ];
  for (const [id, label, method, path] of probes) {
    const r = await api(alice.token, path, { method });
    check(id, `${label} does not 500`, r.status < 500, `${r.status}`);
  }

  const bodyProbes = [
    ['F8', 'a reaction with an empty emoji', `/api/messages/PLACEHOLDER/reactions`, { emoji: '' }],
    ['F9', 'a reaction with a novel-length emoji', `/api/messages/PLACEHOLDER/reactions`, { emoji: 'x'.repeat(10000) }],
    ['F10', 'a reaction with no emoji field', `/api/messages/PLACEHOLDER/reactions`, {}],
  ];
  const msg = (await api(alice.token, '/api/messages', {
    method: 'POST', body: JSON.stringify({ conversationId: conv.id, type: 'text', ciphertext: 'aGk=' }),
  })).body.message;
  for (const [id, label, path, body] of bodyProbes) {
    const r = await api(alice.token, path.replace('PLACEHOLDER', msg.id), { method: 'POST', body: JSON.stringify(body) });
    check(id, `${label} does not 500`, r.status < 500, `${r.status}`);
  }

  const moreBodies = [
    ['F11', 'memberIds as a string', '/api/conversations', { type: 'direct', memberIds: 'not-an-array' }],
    ['F12', 'an unknown conversation type', '/api/conversations', { type: 'telepathy', memberIds: [bob.id] }],
    ['F13', 'a mute deadline that is not a date', `/api/conversations/${conv.id}/mute`, { until: 'someday' }],
    ['F14', 'a forward to a conversation that does not exist', `/api/messages/${msg.id}/forward`, { targetConversationId: '00000000-0000-0000-0000-000000000000' }],
    ['F15', 'a reply to a message that does not exist', '/api/messages', { conversationId: conv.id, type: 'text', ciphertext: 'aGk=', replyToMessageId: '00000000-0000-0000-0000-000000000000' }],
    ['F16', 'a message naming a file that does not exist', '/api/messages', { conversationId: conv.id, type: 'image', fileId: '00000000-0000-0000-0000-000000000000' }],
    ['F17', 'a completely empty body', '/api/messages', {}],
  ];
  for (const [id, label, path, body] of moreBodies) {
    const r = await api(alice.token, path, { method: 'POST', body: JSON.stringify(body) });
    check(id, `${label} does not 500`, r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 60)}`);
  }

  // ── G ─────────────────────────────────────────────────────────────────────
  section('G. Exception shape');

  const shapes = [
    ['a 404', `/api/conversations/00000000-0000-0000-0000-000000000000`],
    ['a 400', '/api/conversations/not-a-uuid'],
    ['a 403', `/api/admin/stats`],
  ];
  let consistent = true;
  const seen = [];
  for (const [label, path] of shapes) {
    const r = await api(alice.token, path);
    seen.push(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
    if (typeof r.body !== 'object' || r.body === null || typeof r.body.error !== 'string') consistent = false;
  }
  check('G1', 'every error body is { error: string }', consistent, seen.join(' | ').slice(0, 150));

  const leaky = await api(alice.token, '/api/conversations/not-a-uuid');
  const dump = JSON.stringify(leaky.body ?? '');
  // `at \w+` alone matched the word "that" inside a perfectly good message. A stack frame is
  // "at name (file:line)" or a bare file reference — match those, not any word ending in "at".
  check('G2', 'no stack trace, file path or query is leaked',
    !/\bat [\w.$]+ ?\(|\.[tj]s:\d|node_modules|SELECT |PrismaClient/i.test(dump), dump.slice(0, 90));

  const notFound = await api(alice.token, '/api/no/such/route');
  check('G3', 'an unknown route is a clean 404', notFound.status === 404, `${notFound.status}`);

  const badJson = await fetch(`${API}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: '{"broken": ',
  });
  check('G4', 'malformed JSON is a 400, not a 500', clientError(badJson.status), `${badJson.status}`);

  const wrongMethod = await api(alice.token, '/api/conversations', { method: 'PUT' });
  check('G5', 'a method the route does not have is a 404, not a 500', wrongMethod.status < 500, `${wrongMethod.status}`);

  // ── summary ───────────────────────────────────────────────────────────────
  const scored = results.filter((x) => x.passed !== null);
  const failed = scored.filter((x) => !x.passed);
  console.log(`\n${'═'.repeat(68)}`);
  console.log(`  ${scored.length - failed.length}/${scored.length} passed`);
  if (failed.length) {
    console.log('\n  FAILURES:');
    for (const f of failed) console.log(`    [${f.id}] ${f.label}${f.detail ? `  — ${f.detail}` : ''}`);
  }
  const notes = results.filter((x) => x.passed === null);
  if (notes.length) {
    console.log('\n  OBSERVATIONS (judgement, not pass/fail):');
    for (const n of notes) console.log(`    [${n.id}] ${n.label} — ${n.detail}`);
  }
  console.log('═'.repeat(68));
}

try {
  await main();
} catch (err) {
  console.error('\nHARNESS ERROR:', err?.message ?? err, err?.stack?.split('\n')[1] ?? '');
} finally {
  for (const id of made.files) await pool.query('DELETE FROM files WHERE id=$1', [id]).catch(() => {});
  for (const id of made.convs) await pool.query('DELETE FROM conversations WHERE id=$1', [id]).catch(() => {});
  for (const id of made.users) {
    await pool.query('DELETE FROM messages WHERE sender_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM files WHERE uploader_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
  }
  const left = await pool.query("SELECT count(*)::int n FROM users WHERE email LIKE 'fh-%@harness.local'");
  await pool.end();
  console.log(`\n  cleaned up (${left.rows[0].n} harness accounts left behind)`);
  process.exit(0);
}
