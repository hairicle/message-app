# 7 — Security test results

A live penetration test against the running API — real accounts, real tokens, real requests, as an
attacker would make them. Not a code review; every result below is an observed response.

**Latest run: 65 of 65 passed.** All findings from the first run have been fixed and re-verified
live; each is kept below with what it was and what changed, because a fixed finding is the part of
a security report worth keeping.

| Run | Commit | Result |
|---|---|---|
| First | `697df1c` | 58 of 64 — three distinct issues |
| After the fixes | `dev2`, current | **65 of 65** |

Re-run it any time:

```bash
npm run test:security --workspace=apps/api
```

The harness lives at [`apps/api/scripts/security-test.mjs`](../../apps/api/scripts/security-test.mjs).
It creates its own throwaway accounts, drives the API over HTTP, and deletes everything it made in
a `finally` block — it never touches existing rows, and it reports how many of its own accounts it
failed to clean up.

## Coverage

| Section | Checks | First run | Now |
|---|---|---|---|
| A — Authentication | 7 | pass | pass |
| B — Authorization / IDOR | 9 | pass | pass |
| C — Privilege escalation and self-lockout | 10 | pass | pass |
| D — Session revocation | 4 | pass | pass |
| E — File access | 7 | pass | pass |
| F — Injection and input handling | 8 | **1 failed** | pass |
| G — Credentials and data exposure | 8 | **1 failed** | pass |
| H — Transport and headers | 4 | **2 failed** | pass |
| I — Rate limiting / brute force | 4 | **2 failed** | pass |
| J — Business rules | 5 | pass | pass |

---

# Findings — all fixed

## S1 — No rate limiting anywhere, including login — **FIXED**

**Was: high.** Checks I1 and I3.

```
before   40 sequential wrong-password attempts in 31.4s  →   0 throttled
         130 authenticated requests in one burst          →   0 throttled

after    40 sequential wrong-password attempts in  2.4s  →  32 throttled, from attempt 9
         400 authenticated requests in one burst          → 102 throttled
```

`ThrottlerModule` was configured for 100 requests/60 s but `ThrottlerGuard` was never bound as an
`APP_GUARD`, so nothing counted requests and the `@Throttle` decorators already sitting on the
login routes never fired. The configuration was decorative.

**What changed.** `AppThrottlerGuard` is now bound globally. Binding the stock guard would have
fixed the counting and broken the product, so what gets counted depends on the request:

| Request | Counted against |
|---|---|
| A signed-in request | the bearer token it carries |
| A login attempt | the address **and** the account it names |
| Anything else | the address |

This matters because it is an internal tool. The whole company reaches the API through one office
address, so the stock per-address counting would have given everybody a single shared budget and
refused them all together on the busiest morning. Two live checks guard against that regression:
I2 confirms the cool-off is temporary rather than a lockout an administrator has to clear
(`Retry-After: 900`, account row still `active`), and I4 confirms one account being guessed does
not block another.

The default budget was also raised from 100/min to **300/min**. The old number had never met real
traffic because it was never enforced — opening a conversation fetches every visible attachment
individually, so a gallery of a hundred photos is a hundred requests in seconds, and enforcing 100
would have rate-limited ordinary scrolling.

`GET /health` is exempt. Every platform health poll comes from one address, and throttling it would
eventually answer 429, which reads as unhealthy and takes the service out of rotation for being up.

**One judgement call to be aware of:** login is capped at **10 attempts per 15 minutes** per
address-and-account. That value was already written on the route; enforcement is what is new. Eight
wrong passwords in a row and that person waits fifteen minutes. It is defensible and it cannot
affect a colleague, but if it proves too harsh in practice the number is one edit in
`auth.controller.ts`.

## S2 — CORS reflects every origin — **FIXED**

**Was: medium.** Checks H3 and H4.

```
before   GET /api/conversations   Origin: https://evil.example.com  →  ACAO: *
         OPTIONS (preflight from the same origin)                   →  204, ACAO: *

after    GET /api/conversations   Origin: https://evil.example.com  →  ACAO: absent
         OPTIONS (preflight from the same origin)                   →  204, ACAO: absent
         GET /api/conversations   Origin: <the web app>             →  ACAO: <the web app>
```

`main.ts` called `app.enableCors()` with no arguments, and the gateway set `origin: true`.
`CORS_ORIGIN` had been set in `render.yaml` and named in the staging walkthrough since staging was
built, and **nothing read it**.

Be precise about what this did and did not mean. The wildcard means browsers will not send cookies,
and the app authenticates with a bearer token held in browser storage, which a page on another
origin cannot read — so a malicious site could **not** ride a signed-in user's session. What it did
mean is that the API answered any origin already holding a token, and a layer that should have been
there was not.

**What changed.** Both the HTTP server and the Socket.IO gateway now read `CORS_ORIGIN` through one
shared helper, `common/cors.ts`, so the two cannot drift apart again — they were previously
configured in different files and both ended up permitting everything. The gateway mattered as much
as the HTTP side: `origin: true` there meant the socket accepted a handshake from any page, which
would have made closing CORS on HTTP alone worth very little. Verified separately, browser-style:

```
socket.io handshake  Origin: http://localhost:3100     →  200, ACAO: http://localhost:3100
socket.io handshake  Origin: https://evil.example.com  →  200, no ACAO  (a browser blocks the read)
```

The helper accepts a comma-separated list and strips trailing slashes — `https://app.example.com/`
never matches, because a browser sends an Origin with no path at all, and the mismatch shows up as
every request failing while the API's own logs look healthy.

**When `CORS_ORIGIN` is unset** the API allows only `localhost:3100` and `localhost:3000`, and logs
a warning naming the variable. It does not fall back to allowing everything: an unset variable is
far more often a deployment that forgot it than a decision to accept any origin, and the failure it
produces should be one browser refusing one request with a legible message, not a service that
looks fine and quietly answers the whole internet.

**This makes `CORS_ORIGIN` a required production variable.** Leave it unset and the deployed web
app cannot reach the API at all.

## S3 — Unhandled type errors return 500 — **FIXED**

**Was: low.** Checks F6 and G1.

| Request | Before | Now |
|---|---|---|
| `POST /api/messages` with `ciphertext: {"$ne": null}` | 500 | **400** |
| `POST /api/messages` with `ciphertext: 12345` | 500 | **400** |
| `POST /api/messages` with `ciphertext: true` | 500 | **400** |
| `POST /api/messages` with `ciphertext: ["a","b"]` | **201 — stored** | **400** |
| `POST /api/users/me/password` with no `currentPassword` | 500 | **400** |

Verified by direct probe at the time that **nothing changed state**: the password hash was
untouched, the old password still worked, and the API stayed up. `changePassword` does check the
current password correctly — it just reached `bcrypt.compare(undefined, hash)`, which throws before
the check can return false. So it was never an authentication bypass.

It mattered because every one of these was logged as a *server* fault, which is how real faults get
lost, and a 500 on a password-change endpoint is exactly the kind of log line that reads as a
breach when someone finds it at 2am. The array case was worse than the others: `Buffer.from`
accepts an array where it throws on an object, so that one was type confusion reaching storage.

**What changed.** `POST /api/messages`, `POST /api/users/me/password` and `PATCH /api/users/me`
now parse their bodies with Zod rather than asserting a TypeScript type the request never had to
keep. The exception filter already turns a `ZodError` into a 400 naming the offending field; these
endpoints simply were not using it.

Two things came along with the schema, both deliberate:

- **`system` is not an accepted message type.** Those are written by the server to narrate events
  like someone joining a group. Letting a client post one would let anyone forge that narration.
- **`PATCH /api/users/me` now strips unknown fields** rather than relying on the service to ignore
  them. The service does ignore `role` and `status` — check C4 confirms it live — but a schema
  makes that a property of the endpoint instead of something the next person to edit the service
  has to remember.

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
