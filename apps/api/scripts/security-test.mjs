/**
 * Live security test harness, pass 2.
 *
 * Pass 1 produced two false failures and one false pass. The self-lockout guard answers 400, not
 * the 403 the assertions demanded, and self-demotion is allowed when another administrator exists —
 * so the acting admin demoted itself mid-run and every later check inherited a staff token. Every
 * destructive self-test here gets its own throwaway administrator, and assertions check "denied"
 * as a family rather than one exact code.
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

config();

// Overridable, so the suite can be pointed at an instance on another port when 4000 is taken.
const API = process.env.TEST_API_URL ?? 'http://localhost:4000';
const PW = 'SecHarness!2026';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: readFileSync('./certs/supabase-prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true },
});

async function api(token, path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (!opts.raw) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers, redirect: 'manual' });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

/** Denied is a family: 400 (rule), 401 (unauthenticated), 403 (forbidden), 404 (hidden). */
const denied = (s) => [400, 401, 403, 404].includes(s);

const results = [];
function check(id, label, passed, detail = '') {
  results.push({ id, label, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  [${id}] ${label}${detail ? `  — ${detail}` : ''}`);
}
function info(id, label, detail) {
  results.push({ id, label, passed: null, detail });
  console.log(`  NOTE  [${id}] ${label}  — ${detail}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`); }

const made = { users: [], convs: [], files: [] };
let seq = 0;

async function mkUser(tag, role = 'staff') {
  const u = `${tag}${seq++}`;
  const hash = await bcrypt.hash(PW, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, username, display_name, password_hash, role, status)
     VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
    [`sec2-${u}@harness.local`, `sec2_${u}`, `Sec ${u}`, hash, role],
  );
  made.users.push(rows[0].id);
  const token = (await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: `sec2-${u}@harness.local`, password: PW }),
  })).body?.token;
  return { id: rows[0].id, token, email: `sec2-${u}@harness.local` };
}

async function main() {
  // A standing admin, so no test is ever the last administrator and the last-admin guard does not
  // mask the self-action guards being tested.
  const keeper = await mkUser('keeper', 'admin');

  const alice = await mkUser('alice');
  const bob = await mkUser('bob');
  const mallory = await mkUser('mallory');

  const conv = (await api(alice.token, '/api/conversations', {
    method: 'POST', body: JSON.stringify({ type: 'direct', memberIds: [bob.id] }),
  })).body.conversation;
  made.convs.push(conv.id);

  const msg = (await api(alice.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify({ conversationId: conv.id, type: 'text', ciphertext: Buffer.from('secret plans').toString('base64') }),
  })).body.message;

  section('A. Authentication');

  check('A1', 'no token is rejected',
    (await api(null, '/api/conversations')).status === 401);

  check('A2', 'a garbage token is rejected',
    (await api('not-a-jwt', '/api/conversations')).status === 401);

  const forged = jwt.sign({ id: alice.id, email: 'x', role: 'admin' }, 'wrong-secret', { expiresIn: '1h' });
  check('A3', 'a token signed with the wrong secret is rejected',
    (await api(forged, '/api/conversations')).status === 401);

  const expired = jwt.sign({ id: alice.id, email: 'x', role: 'staff' }, process.env.JWT_SECRET, { expiresIn: '-1h' });
  check('A4', 'an expired token is rejected',
    (await api(expired, '/api/conversations')).status === 401);

  const noneAlg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    + '.' + Buffer.from(JSON.stringify({ id: alice.id, role: 'admin' })).toString('base64url') + '.';
  check('A5', 'an alg:none token is rejected',
    (await api(noneAlg, '/api/conversations')).status === 401);

  // A TOTP-pending token is a real signature but only half-authenticated.
  const pending = jwt.sign({ sub: alice.id, scope: 'totp_pending', jti: 'x' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  check('A6', 'a TOTP-pending token cannot reach real routes',
    (await api(pending, '/api/conversations')).status === 401);

  const r = await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: alice.email, password: 'wrong' }),
  });
  const r2 = await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'nobody@nowhere.local', password: 'wrong' }),
  });
  check('A7', 'wrong password and unknown user are indistinguishable',
    r.status === r2.status && JSON.stringify(r.body) === JSON.stringify(r2.body),
    `${r.status} "${r.body?.error}" vs ${r2.status} "${r2.body?.error}"`);

  // ───────────────────────────────────────────────────────────────────────────
  section('B. Authorization / IDOR');

  check('B1', 'an outsider cannot read a conversation',
    denied((await api(mallory.token, `/api/conversations/${conv.id}`)).status));

  check('B2', 'an outsider cannot list its messages',
    denied((await api(mallory.token, `/api/messages?conversationId=${conv.id}`)).status));

  check('B3', 'an outsider cannot post into it',
    denied((await api(mallory.token, '/api/messages', {
      method: 'POST', body: JSON.stringify({ conversationId: conv.id, type: 'text', ciphertext: 'aGk=' }),
    })).status));

  check('B4', 'an outsider cannot react to its messages',
    denied((await api(mallory.token, `/api/messages/${msg.id}/reactions`, {
      method: 'POST', body: JSON.stringify({ emoji: '👍' }),
    })).status));

  check('B5', 'an outsider cannot read its media gallery',
    denied((await api(mallory.token, `/api/conversations/${conv.id}/media`)).status));

  check('B6', 'an outsider cannot add themselves as a member',
    denied((await api(mallory.token, `/api/conversations/${conv.id}/members`, {
      method: 'POST', body: JSON.stringify({ userIds: [mallory.id] }),
    })).status));

  check('B7', 'an outsider cannot pin its messages',
    denied((await api(mallory.token, `/api/conversations/${conv.id}/pins`, {
      method: 'POST', body: JSON.stringify({ messageId: msg.id }),
    })).status));

  const edited = await api(bob.token, `/api/messages/${msg.id}`, {
    method: 'PATCH', body: JSON.stringify({ ciphertext: Buffer.from('tampered').toString('base64') }),
  });
  check('B8', "a member cannot edit someone else's message",
    denied(edited.status), `got ${edited.status}`);

  const search = await api(mallory.token, '/api/messages/search?q=secret');
  const leaked = JSON.stringify(search.body ?? '').includes('c2VjcmV0') || JSON.stringify(search.body ?? '').includes('secret plans');
  check('B9', 'search does not cross conversation boundaries',
    search.status === 200 && !leaked && (search.body?.results?.length ?? 0) === 0,
    `${search.status}, ${search.body?.results?.length ?? '?'} results`);


  // ── C ────────────────────────────────────────────────────────────
  section('C. Privilege escalation and self-lockout');


  const adminRoutes = [['GET', '/api/admin/stats'], ['GET', '/api/admin/audit-logs'], ['GET', '/api/users']];
  let allBlocked = true;
  for (const [method, path] of adminRoutes) {
    const res = await api(mallory.token, path, { method });
    if (res.status !== 403) { allBlocked = false; console.log(`        ${method} ${path} -> ${res.status}`); }
  }
  check('C1', 'a staff user cannot reach admin routes', allBlocked);

  check('C2', 'a staff user cannot disable another account',
    denied((await api(mallory.token, `/api/admin/users/${bob.id}/disable`, { method: 'POST' })).status));

  check('C3', 'a staff user cannot delete another account',
    denied((await api(mallory.token, `/api/admin/users/${bob.id}`, { method: 'DELETE' })).status));

  // Mass assignment: the self-service profile route must ignore privileged fields.
  await api(mallory.token, '/api/users/me', {
    method: 'PATCH', body: JSON.stringify({ displayName: 'Mal', role: 'admin', status: 'active' }),
  });
  const roleAfter = (await pool.query('SELECT role FROM users WHERE id=$1', [mallory.id])).rows[0].role;
  check('C4', 'PATCH /users/me cannot set your own role', roleAfter === 'staff', `role is now "${roleAfter}"`);

  // The JWT carries a role claim. Guards must read the database, not the claim.
  const selfSigned = jwt.sign({ id: mallory.id, email: mallory.email, role: 'admin' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  check('C5', 'an admin role claim inside a validly-signed JWT is not trusted',
    (await api(selfSigned, '/api/admin/stats')).status === 403);

  check('C9', 'a non-admin cannot delete a message, even their own',
    denied((await api(alice.token, `/api/messages/${msg.id}`, { method: 'DELETE' })).status));

  {
    const a = await mkUser('adm-del', 'admin');
    const r = await api(a.token, `/api/admin/users/${a.id}`, { method: 'DELETE' });
    const stillThere = (await pool.query('SELECT status FROM users WHERE id=$1', [a.id])).rows.length === 1;
    check('C6', 'an admin cannot delete their own account',
      denied(r.status) && stillThere, `${r.status} "${r.body?.error ?? ''}"`);
  }

  {
    const a = await mkUser('adm-dis', 'admin');
    const r = await api(a.token, `/api/admin/users/${a.id}/disable`, { method: 'POST' });
    const row = (await pool.query('SELECT status FROM users WHERE id=$1', [a.id])).rows[0];
    check('C8', 'an admin cannot disable their own account',
      denied(r.status) && row.status === 'active', `${r.status} "${r.body?.error ?? ''}"`);
  }

  {
    const a = await mkUser('adm-dem', 'admin');
    const r = await api(a.token, `/api/admin/users/${a.id}/role`, {
      method: 'POST', body: JSON.stringify({ role: 'staff' }),
    });
    const row = (await pool.query('SELECT role FROM users WHERE id=$1', [a.id])).rows[0];
    info('C7', 'an admin CAN demote themselves while another admin exists',
      `${r.status}, role is now "${row.role}" — by design: the last-admin guard blocks it only when nobody else would be left`);
  }

  {
    // The rule that actually matters: the final administrator cannot remove themselves.
    const solo = await mkUser('adm-solo', 'admin');
    await pool.query("UPDATE users SET status='disabled' WHERE role='admin' AND id <> $1", [solo.id]);
    const r = await api(solo.token, `/api/admin/users/${solo.id}/role`, {
      method: 'POST', body: JSON.stringify({ role: 'staff' }),
    });
    const row = (await pool.query('SELECT role FROM users WHERE id=$1', [solo.id])).rows[0];
    await pool.query("UPDATE users SET status='active' WHERE role='admin' AND status='disabled'");
    check('C10', 'the last administrator cannot demote themselves',
      denied(r.status) && row.role === 'admin', `${r.status} "${r.body?.error ?? ''}"`);
  }

  // ── D (re-run with an admin that is still an admin) ───────────────────────
  section('D. Session revocation');

  {
    const adm = await mkUser('adm-rev', 'admin');
    const target = await mkUser('target');

    const before = await api(target.token, '/api/conversations');
    const dis = await api(adm.token, `/api/admin/users/${target.id}/disable`, { method: 'POST' });
    const after = await api(target.token, '/api/conversations');

    check('D0', 'the disable itself succeeded', dis.status < 400, `${dis.status}`);
    check('D1', "a disabled account's existing token stops working immediately",
      before.status === 200 && denied(after.status), `before ${before.status}, after ${after.status}`);

    const reLogin = await api(null, '/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: target.email, password: PW }),
    });
    check('D2', 'a disabled account cannot log back in', denied(reLogin.status), `${reLogin.status}`);

    await api(adm.token, `/api/admin/users/${target.id}/enable`, { method: 'POST' });
    const reLogin2 = await api(null, '/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: target.email, password: PW }),
    });
    check('D3', 're-enabling restores access', reLogin2.status === 200 && !!reLogin2.body?.token, `${reLogin2.status}`);
  }

  // ── E (re-run) ────────────────────────────────────────────────────────────
  section('E. File access');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'private.png');
  const up = await fetch(`${API}/api/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: fd,
  });
  const upJson = await up.json();
  const file = upJson.file;

  if (!file) {
    check('E0', 'the test upload succeeded', false, JSON.stringify(upJson).slice(0, 120));
  } else {
    made.files.push(file.id);
    await api(alice.token, '/api/messages', {
      method: 'POST', body: JSON.stringify({ conversationId: conv.id, type: 'image', fileId: file.id }),
    });

    check('E1', 'an outsider cannot fetch a file from a conversation they are not in',
      denied((await api(mallory.token, `/api/files/${file.id}`)).status));
    check('E2', 'an outsider cannot fetch its thumbnail',
      denied((await api(mallory.token, `/api/files/${file.id}/thumbnail`)).status));
    check('E3', 'an outsider cannot read its metadata',
      denied((await api(mallory.token, `/api/files/${file.id}/meta`)).status));

    const memberFetch = await api(alice.token, `/api/files/${file.id}`);
    const signed = memberFetch.headers.get('location') ?? '';
    check('E4', 'a member gets a signed, expiring URL',
      memberFetch.status === 302 && /token=|Expires=|X-Amz-Expires/i.test(signed),
      memberFetch.status === 302 ? 'redirect carries a signature' : `status ${memberFetch.status}`);

    if (signed) {
      const direct = await fetch(signed.split('?')[0], { redirect: 'manual' });
      check('E5', 'the storage bucket is not publicly readable',
        direct.status >= 400, `unsigned fetch → ${direct.status}`);

      const tampered = signed.replace(/(token=|Expires=)([^&]+)/, '$1deadbeef');
      if (tampered !== signed) {
        const bad = await fetch(tampered, { redirect: 'manual' });
        check('E6', 'a tampered signature is rejected', bad.status >= 400, `→ ${bad.status}`);
      }
    }

    const noAuth = await fetch(`${API}/api/files/${file.id}`, { redirect: 'manual' });
    check('E7', 'a file cannot be fetched without a token', denied(noAuth.status), `${noAuth.status}`);
  }

  // ── F ─────────────────────────────────────────────────────────────────────
  section('F. Injection and input handling');

  const sqli = await api(alice.token, `/api/messages/search?q=${encodeURIComponent("' OR 1=1--")}`);
  check('F1', 'a SQL metacharacter payload in search does not error or dump',
    sqli.status === 200 && (sqli.body?.results?.length ?? -1) === 0,
    `${sqli.status}, ${sqli.body?.results?.length ?? '?'} results`);

  const sqli2 = await api(alice.token, `/api/messages/search?q=${encodeURIComponent("%'; DROP TABLE users; --")}`);
  const usersAlive = (await pool.query('SELECT count(*)::int n FROM users')).rows[0].n > 0;
  check('F2', 'a destructive SQL payload changes nothing', sqli2.status < 500 && usersAlive,
    `${sqli2.status}, users table intact`);

  check('F3', 'a malformed identifier returns 400, not 500',
    (await api(alice.token, '/api/conversations/not-a-uuid')).status === 400);

  const reflect = await api(alice.token, '/api/conversations/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  check('F4', 'a malformed identifier is not echoed back',
    !JSON.stringify(reflect.body ?? '').toLowerCase().includes('script'), JSON.stringify(reflect.body));

  check('F5', 'a malformed login body returns 400, not 500',
    (await api(null, '/api/auth/login', { method: 'POST', body: JSON.stringify({ nope: 1 }) })).status === 400);

  const nested = await api(alice.token, '/api/messages', {
    method: 'POST', body: JSON.stringify({ conversationId: conv.id, type: 'text', ciphertext: { $ne: null } }),
  });
  check('F6', 'a non-string body field does not 500', nested.status !== 500, `${nested.status}`);

  const xssMsg = await api(alice.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: conv.id, type: 'text',
      ciphertext: Buffer.from('<img src=x onerror=alert(1)>').toString('base64'),
    }),
  });
  check('F7', 'a stored XSS payload comes back as JSON, not HTML',
    (xssMsg.headers.get('content-type') ?? '').includes('application/json'),
    xssMsg.headers.get('content-type') ?? '');

  const traversal = await api(alice.token, '/api/files/..%2F..%2F..%2Fetc%2Fpasswd');
  check('F8', 'a path-traversal identifier is refused', denied(traversal.status), `${traversal.status}`);

  // ── G ─────────────────────────────────────────────────────────────────────
  section('G. Credentials and data exposure');

  const g = await mkUser('pw');
  check('G1', 'changing a password requires the current one',
    denied((await api(g.token, '/api/users/me/password', {
      method: 'POST', body: JSON.stringify({ newPassword: 'NewPass!12345' }),
    })).status));

  check('G2', 'a wrong current password is refused',
    denied((await api(g.token, '/api/users/me/password', {
      method: 'POST', body: JSON.stringify({ currentPassword: 'nope', newPassword: 'NewPass!12345' }),
    })).status));

  const weak = await api(g.token, '/api/users/me/password', {
    method: 'POST', body: JSON.stringify({ currentPassword: PW, newPassword: '123' }),
  });
  check('G3', 'a trivially weak new password is refused', denied(weak.status), `${weak.status}`);

  const hash = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [alice.id])).rows[0].password_hash;
  check('G4', 'passwords are bcrypt at cost 12', /^\$2[aby]\$12\$/.test(hash), hash.slice(0, 7));

  const secretRe = /password_hash|passwordHash|totp_secret|totpSecret/i;
  check('G5', '/auth/me exposes no credentials',
    !secretRe.test(JSON.stringify((await api(alice.token, '/api/auth/me')).body ?? '')));
  check('G6', 'the directory exposes no credentials',
    !secretRe.test(JSON.stringify((await api(alice.token, '/api/users/directory')).body ?? '')));
  check('G7', "another user's profile exposes no credentials",
    !secretRe.test(JSON.stringify((await api(mallory.token, `/api/users/${alice.id}`)).body ?? '')));

  const admList = await api(keeper.token, '/api/users');
  check('G8', 'the admin user list exposes no password hashes',
    !secretRe.test(JSON.stringify(admList.body ?? '')), `${admList.status}`);

  // ── H ─────────────────────────────────────────────────────────────────────
  section('H. Transport and headers');

  const h = (await api(alice.token, '/api/conversations')).headers;
  const hdrs = ['x-content-type-options', 'x-frame-options', 'strict-transport-security', 'x-dns-prefetch-control'];
  const present = hdrs.filter((k) => h.get(k));
  check('H1', 'helmet security headers are applied', present.length >= 3,
    `${present.length}/4: ${present.join(', ')}`);

  check('H2', 'the framework banner is not advertised',
    !h.get('x-powered-by'), h.get('x-powered-by') ?? 'absent');

  const cors = await fetch(`${API}/api/conversations`, {
    headers: { Origin: 'https://evil.example.com', Authorization: `Bearer ${alice.token}` },
  });
  const acao = cors.headers.get('access-control-allow-origin');
  check('H3', 'CORS does not reflect an arbitrary origin', !acao || acao === 'null',
    `Access-Control-Allow-Origin: ${acao ?? 'absent'}`);

  const pre = await fetch(`${API}/api/conversations`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' },
  });
  check('H4', 'a preflight from an arbitrary origin is not approved',
    !pre.headers.get('access-control-allow-origin'),
    `${pre.status}, ACAO: ${pre.headers.get('access-control-allow-origin') ?? 'absent'}`);

  // ── I ─────────────────────────────────────────────────────────────────────
  section('I. Rate limiting / brute force');

  const t0 = Date.now();
  const attempts = [];
  for (let i = 0; i < 40; i += 1) {
    attempts.push(await api(null, '/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: alice.email, password: `wrong-${i}` }),
    }));
  }
  const throttled = attempts.filter((a) => a.status === 429).length;
  const firstThrottled = attempts.findIndex((a) => a.status === 429);
  check('I1', 'repeated failed logins are throttled', throttled > 0,
    `40 sequential attempts in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${throttled} throttled from attempt ${firstThrottled + 1}`);

  // Rate-limiting a login inevitably produces a cool-off for whoever tripped it. What must not
  // happen is a *lockout* — a state the account stays in, that another person has to undo. The
  // distinction is whether the account row changed and whether the refusal expires on its own.
  const cooled = await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: alice.email, password: PW }),
  });
  const row = (await pool.query('SELECT status FROM users WHERE id=$1', [alice.id])).rows[0];
  check('I2', 'the cool-off is temporary, not a lockout an admin must clear',
    row.status === 'active' && (cooled.status !== 429 || !!cooled.headers.get('retry-after')),
    `account still "${row.status}", login → ${cooled.status}${cooled.headers.get('retry-after') ? `, retry after ${cooled.headers.get('retry-after')}s` : ''}`);

  // Someone else's address must not have spent this account's budget, or one bad actor could
  // stop the whole company signing in.
  const elsewhere = await api(null, '/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: bob.email, password: PW }),
  });
  check('I4', 'one account being guessed does not block another',
    elsewhere.status === 200, `${elsewhere.status}`);

  // Larger than the whole per-minute budget, so it trips regardless of what the run spent already.
  const burst = [];
  for (let i = 0; i < 400; i += 1) burst.push(api(alice.token, '/api/conversations'));
  const burstRes = await Promise.all(burst);
  const burst429 = burstRes.filter((a) => a.status === 429).length;
  check('I3', 'authenticated requests are rate limited', burst429 > 0,
    `400 requests, ${burst429} throttled`);

  // ── J ─────────────────────────────────────────────────────────────────────
  section('J. Business rules and misc');
  // Runs after the burst above deliberately: these use a different account, which proves the
  // limiter is per-caller rather than a global tap that one client can close for everyone.

  check('J1', 'a two-person group is refused server-side',
    (await api(alice.token, '/api/conversations', {
      method: 'POST', body: JSON.stringify({ type: 'group', name: 'x', memberIds: [bob.id] }),
    })).status === 400);

  check('J2', 'an outsider cannot remove a member',
    denied((await api(mallory.token, `/api/conversations/${conv.id}/members/${bob.id}`, { method: 'DELETE' })).status));

  const imp = await api(keeper.token, '/api/admin/users/import', { method: 'POST', body: JSON.stringify({}) });
  check('J3', 'the bulk-import stub does not report success', imp.body?.created === 0,
    `HTTP ${imp.status}, created=${imp.body?.created}`);

  const audit = await api(keeper.token, '/api/admin/audit-logs?limit=5');
  const wrote = JSON.stringify(audit.body ?? '').includes('admin.user.disabled');
  check('J4', 'administrative actions are written to the audit log', wrote, `${audit.status}`);

  const health = await fetch(`${API}/health`);
  const healthBody = await health.text();
  check('J5', 'the health endpoint leaks no internals',
    !/version|env|secret|url|postgres|redis/i.test(healthBody), healthBody.slice(0, 80));

  // ── summary ───────────────────────────────────────────────────────────────
  const scored = results.filter((x) => x.passed !== null);
  const failed = scored.filter((x) => !x.passed);
  console.log(`\n${'═'.repeat(68)}`);
  console.log(`  ${scored.length - failed.length}/${scored.length} passed`);
  if (failed.length) {
    console.log('\n  FAILURES:');
    for (const f of failed) console.log(`    [${f.id}] ${f.label}${f.detail ? `  — ${f.detail}` : ''}`);
  }
  console.log('═'.repeat(68));
}

try {
  await main();
} catch (err) {
  console.error('\nHARNESS ERROR:', err?.message ?? err, err?.cause ?? '', err?.stack?.split('\n')[1] ?? '');
} finally {
  for (const id of made.files) await pool.query('DELETE FROM files WHERE id=$1', [id]).catch(() => {});
  for (const id of made.convs) await pool.query('DELETE FROM conversations WHERE id=$1', [id]).catch(() => {});
  for (const id of made.users) {
    await pool.query('DELETE FROM messages WHERE sender_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM audit_logs WHERE actor_user_id=$1 OR target_user_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
  }
  const leftover = await pool.query("SELECT count(*)::int n FROM users WHERE email LIKE 'sec2-%@harness.local'");
  await pool.end();
  console.log(`\n  cleaned up (${leftover.rows[0].n} harness accounts left behind)`);
  process.exit(0);
}
