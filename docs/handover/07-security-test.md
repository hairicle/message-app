# 7 — Security test results

A live penetration test against the running API — real accounts, real tokens, real requests, as an
attacker would make them. Not a code review; every result below is an observed response.

**Run:** 2026-08-11, `dev2` at `697df1c`, against a local API on the production Supabase and
Upstash instances.
**Result: 58 of 64 passed.** The six failures are four distinct issues, described below.

Re-run it any time:

```bash
npm run test:security --workspace=apps/api
```

The harness lives at [`apps/api/scripts/security-test.mjs`](../../apps/api/scripts/security-test.mjs).
It creates its own throwaway accounts, drives the API over HTTP, and deletes everything it made in
a `finally` block — it never touches existing rows, and it reports how many of its own accounts it
failed to clean up.

## Coverage

| Section | Checks | Result |
|---|---|---|
| A — Authentication | 7 | all passed |
| B — Authorization / IDOR | 9 | all passed |
| C — Privilege escalation and self-lockout | 10 | all passed (1 design note) |
| D — Session revocation | 4 | all passed |
| E — File access | 7 | all passed |
| F — Injection and input handling | 8 | **1 failed** |
| G — Credentials and data exposure | 8 | **1 failed** |
| H — Transport and headers | 4 | **2 failed** |
| I — Rate limiting / brute force | 3 | **2 failed** |
| J — Business rules | 5 | all passed |

---

# Findings

## S1 — No rate limiting anywhere, including login

**Severity: high.** Checks I1 and I3.

```
40 sequential wrong-password attempts in 31.4s  →  0 throttled
130 authenticated requests in one burst          →  0 throttled
```

`ThrottlerModule` is configured for 100 requests/60s in `app.module.ts`, but `ThrottlerGuard` is
never bound as an `APP_GUARD`, so nothing counts requests. The configuration is decorative.

Password guessing against `POST /api/auth/login` is limited only by bcrypt's cost — roughly one
attempt per 300 ms per connection, and nothing stops an attacker opening a hundred connections.
There is no account lockout either (confirmed by I2, which is the right trade-off on its own: a
lockout would let anyone deny service to a colleague by guessing at their account). But with
neither throttling *nor* lockout, there is nothing at all between an attacker and unlimited guesses.

**Fix:** bind the guard, or put a rate limit at the edge before going live. Both.

## S2 — CORS reflects every origin

**Severity: medium.** Checks H3 and H4.

```
GET  /api/conversations   Origin: https://evil.example.com  →  Access-Control-Allow-Origin: *
OPTIONS /api/conversations (preflight from the same origin) →  204, Access-Control-Allow-Origin: *
```

`main.ts` calls `app.enableCors()` with no arguments. `CORS_ORIGIN` is set in `render.yaml` and
named in the staging walkthrough, and **no code reads it**.

Be precise about what this does and does not mean. The wildcard means browsers will not send
cookies, and the app authenticates with a bearer token held in browser storage, which a page on
another origin cannot read. So a malicious site **cannot** ride a signed-in user's session. What it
does mean: the API answers any origin that already holds a token, and a layer that should be there
is not. Any security review will raise it.

**Fix:** two lines — read the variable that is already being set, in `main.ts` and in the
`@WebSocketGateway` decorator.

## S3 — Unhandled type errors return 500

**Severity: low.** Checks F6 and G1.

Two instances found, and they are almost certainly a class rather than a pair:

| Request | Response |
|---|---|
| `POST /api/messages` with `ciphertext: {"$ne": null}` | **500** |
| `POST /api/messages` with `ciphertext: 12345` | **500** |
| `POST /api/messages` with `ciphertext: true` | **500** |
| `POST /api/users/me/password` with no `currentPassword` | **500** |

Verified by direct probe that **nothing changes state**: the password hash is untouched, the old
password still works, and the API stays up. `changePassword` does check the current password
correctly — it just reaches `bcrypt.compare(undefined, hash)`, which throws before the check can
return false.

So this is not an authentication bypass. It matters because every one of these is logged as a
server fault, which is how real faults get lost, and a 500 on a password-change endpoint is exactly
the kind of thing that looks like a breach when someone finds it in a log at 2am.

Worth noting one oddity found while probing: `ciphertext: ["a","b"]` is **accepted** with 201 —
`Buffer.from(array)` succeeds where the others throw. That is type confusion reaching storage.

**Fix:** validate these bodies with the Zod schemas the exception filter already understands. The
filter turns a `ZodError` into a 400 with field names; the endpoints just are not using it.

## Design note — an admin can demote themselves

Not a finding. Check C7 observed that an administrator **can** change their own role to `staff`,
returning 201. The guard blocks it only when they are the last active administrator (confirmed by
C10, which returns 400 *"This is the only administrator"*).

That is the right rule — the thing worth preventing is locking everyone out, and someone stepping
down while colleagues remain is legitimate. Recorded here because the earlier documentation said
"an admin cannot demote, disable or delete their own account", which is not quite what the code
does. Delete-self and disable-self **are** always blocked (C6, C8).

---

# What passed, and is worth knowing passed

These are the controls that would matter most in an incident, all confirmed live:

**Authentication (A1–A7)** — a request with no token, a garbage token, a token signed with the
wrong secret, an expired token, an `alg:none` token, and a half-authenticated TOTP-pending token
are all rejected with 401. Wrong password and unknown user return byte-identical responses, so the
endpoint does not enumerate accounts.

**Authorization (B1–B9)** — a user outside a conversation cannot read it, list its messages, post
into it, react, read its media gallery, add themselves as a member, or pin anything. A member
cannot edit another member's message. **Search does not cross conversation boundaries** — the
outsider's search for a word present in the private thread returned zero results.

**Privilege escalation (C1–C5)** — a staff user gets 403 on every admin route. `PATCH /users/me`
with `role: "admin"` in the body does not change their role. And the important one: a JWT that is
**validly signed with the real secret** but carries `role: "admin"` is refused, because the guard
reads the role from the database rather than the claim.

**Session revocation (D1–D3)** — disabling an account makes its existing token stop working on the
very next request (200 before, 403 after), and it cannot log back in. Re-enabling restores access.

**File access (E1–E7)** — an outsider cannot fetch a file, its thumbnail, or its metadata. A member
gets a 302 to a signed, expiring URL. **The storage bucket is not publicly readable** — stripping
the signature returns 400, and tampering with it returns 400. No token, no file.

**Injection (F1–F5, F7, F8)** — SQL metacharacters and a `DROP TABLE` payload in search return 200
with zero results and change nothing. A non-UUID identifier returns 400, not 500, and the offending
value is **not echoed back** into the response. Path traversal in a file id is refused. Stored XSS
comes back as `application/json`, not markup.

**Data exposure (G4–G8)** — passwords are bcrypt at cost 12. No password hash or TOTP secret
appears in `/auth/me`, the user directory, another user's public profile, or the admin user list.

**Headers (H1, H2)** — all four helmet headers present; no `X-Powered-By`.

**Audit (J4)** — administrative actions are written to the audit log, confirmed by reading it back.

---

# Not covered by this test

Say so plainly rather than let the pass rate imply more than it shows:

- **The WebSocket gateway** is not exercised. The handshake applies the same three checks as
  `JwtAuthGuard` (verified by reading the code, not by test), but no socket-level authorization
  test exists.
- **The web client** is not tested. No XSS-in-render check, no CSP review, no check of how the
  token is stored in the browser.
- **The call feature** is untested because it does not work —
  see [G1 in the gaps register](06-gaps.md#g1-the-audio-and-video-call-buttons-do-not-work-and-leave-the-camera-on).
- **Dependency vulnerabilities** — run `npm audit` separately.
- **No load or DoS testing** beyond the 130-request burst.
- **Encryption at rest** is out of scope because there is none;
  see [G5](06-gaps.md#g5-messages-are-not-encrypted).
