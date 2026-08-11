# 6 — Gaps register

Everything known to be missing, stubbed, dead or broken, in severity order. Compiled by auditing
the code on `dev2` at `9b46aab`, not from a backlog — several of these are not tracked anywhere
else.

Each entry says what is wrong, how it shows up, and what closing it involves.

---

## Blocking — fix or hide before production

### G1. The audio and video call buttons do not work, and leave the camera on

**Severity: high. This is user-facing and privacy-visible.**

Every conversation header shows an audio-call and a video-call button
([`MessageThread.tsx:1259`](../../apps/web/src/components/MessageThread.tsx#L1259)). Pressing
either:

1. calls `getUserMedia` — **the microphone and camera turn on, and the browser shows the recording
   indicator**;
2. emits `call:start`;
3. waits for an acknowledgement that never arrives.

The client and the server implement **different, non-overlapping protocols**:

| Direction | Client uses | Server implements |
|---|---|---|
| Client → server | `call:start`, `call:end`, `call:reject` | `call:offer`, `call:answer`, `call:ice-candidate`, `call:reject` |
| Server → client | listens for `call:incoming`, `call:ended` | emits `call:offer`, `call:answer`, `call:ice-candidate`, `call:reject` |

Only `call:reject` appears on both sides, and even there the payloads disagree — the client sends
`{ callId, initiatorUserId }`, the gateway expects `{ targetUserId }`.

**The media stream is never released.** Both cleanup paths are unreachable: `endCall()` requires
`activeCall`, which is only set inside the `call:start` acknowledgement that never fires; and
`handleCallEnded` waits for `call:ended`, which the server never sends. The camera and microphone
stay on until the tab is closed.

There is also no media path at all even if signalling were fixed: `peerConnectionRef` is declared
but `new RTCPeerConnection` is never called anywhere in the codebase, and no TURN or STUN server is
configured.

**Do before production:** hide the two buttons. That is a small change and removes the problem
entirely. Building calls properly is a feature project — signalling, peer connections, TURN
hosting, and the call UI — not a fix.

---

## Security and operations

### G2. CORS accepts every origin

`main.ts` calls `app.enableCors()` with no arguments; the gateway sets `cors: { origin: true }`.
`CORS_ORIGIN` is set in `render.yaml` and named in the staging walkthrough, but **no code reads
it** — setting it does nothing.

Requests still need a bearer token and the token is not in a cookie, so this is not directly a CSRF
hole. It is still a missing layer and any security review will raise it. One line in `main.ts`, one
in the gateway decorator.

**Confirmed live** ([07-security-test.md](07-security-test.md#s2--cors-reflects-every-origin)): a
request carrying `Origin: https://evil.example.com` comes back with `Access-Control-Allow-Origin: *`,
and a preflight from that origin is approved with 204.

### G3. Rate limiting is registered but never enforced

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` is configured in `app.module.ts`, but
`ThrottlerGuard` is never bound as an `APP_GUARD`. No request is counted.

**`POST /api/auth/login` is unthrottled** — password guessing is limited only by bcrypt's cost.
Either bind the guard or put a limit at the edge before going live.

**Confirmed live** ([07-security-test.md](07-security-test.md#s1--no-rate-limiting-anywhere-including-login)):
40 sequential wrong-password attempts in 31.4 s, none throttled; 130 authenticated requests in one
burst, none throttled. There is no account lockout either — correctly so, since one would let
anyone deny a colleague service by guessing at their account — which means nothing at all stands
between an attacker and unlimited guesses.

### G4. The API cannot run more than one instance

Socket.IO rooms live in the Node process's memory and the Socket.IO Redis adapter is not wired up.
Two instances means two users connected to different ones never see each other's messages — and it
fails **silently**, which is the dangerous part. Redis is already provisioned, so the change is
small, but until it is made, do not scale the service horizontally or enable autoscaling.

### G5. Messages are not encrypted

The column is named `ciphertext` but holds base64-encoded plaintext. Anyone with database access —
including Supabase support and anyone holding the service key — can read every message. The
`signal_identity_keys`, `signal_prekeys` and `signal_signed_prekeys` tables exist and are referenced
by nothing.

A known Phase 3 item. It matters because the project is described internally as giving full control
over encryption keys, and that part is not built.

---

## Dead configuration

### G6. Seven environment variables have no effect

| Variable | Reality |
|---|---|
| `CORS_ORIGIN` | Never read. See G2. |
| `FRONTEND_URL` | Loaded into config, read by nothing. |
| `MAX_FILE_SIZE_MB` | Loaded into `maxFileSizeBytes`, read by nothing. The real limit is a hard-coded 50 MB in **both** `files.controller.ts` and `files.service.ts` — changing it means changing code in two places. |
| `UPLOADS_DIR` | Left from the pre-Supabase local-disk storage. |
| `LDAP_*` (5 variables) | `ldapts` is installed and the config is parsed, but no code path authenticates against LDAP. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` / `_PATH` | `firebase-admin` is installed and the config is parsed. Nothing sends a push notification. |

Anyone tuning these is tuning nothing. `ldapts` and `firebase-admin` can also be dropped from
`package.json` until their features are built — they are shipped in the production image today for
no reason.

---

## Stubs and unbuilt features

### G7. Bulk user import is a stub

`POST /api/admin/users/import` ignores its input and always returns
`{ created: 0, failed: [{ … 'Bulk import not yet implemented' }] }` with HTTP **201**. The success
status on a total failure is the trap — do not wire anything to it.

### G8. Link previews are rendered but never generated

`MessageThread.tsx` renders `message.linkPreview` — title, description, image, site name — and the
`LinkPreview` type exists in `packages/shared`. The API populates it nowhere, and the
`link_previews` table is referenced by no query. The field is always `null`, so the renderer is
dead code.

### G9. Teams and Announce are built but gated off

`TeamWorkspace.tsx` and `AnnounceWorkspace.tsx` exist and are wired into the shell, but the
`COMING_SOON` map intercepts both sections and renders a placeholder instead. Deleting the entry
turns the feature on — so before that happens, someone should QA them; they have never been used in
anger.

The API behind Teams (`/api/teams`, 8 routes) is live and reachable by any authenticated user right
now, regardless of the UI gate.

### G10. Tasks and meetings are API-only

`/api/tasks` (4 routes) and `/api/meetings` (3 routes) work and are reachable. There is no UI, and
no client module in `apps/web/src/lib/api/` — nothing in the web app references them.

Together with G9's team routes and G1's call routes, that is **18 routes reachable by any
authenticated user with no UI in front of them.** Consider blocking them at the edge until their
features ship.

### G11. Push notifications are not built

In-browser notifications *do* work — sound plus the `Notification` API, with per-user preferences.
But that only fires while the tab is open. There is no service worker and no Firebase delivery
path, so a closed tab or a phone gets nothing.

### G12. Mobile apps

Phase 4. Nothing exists. The web app is responsive and works on a phone browser.

---

## Data issues

### G13. Fifteen accounts have a role the code does not recognise

Current production data:

| `users.role` | Count |
|---|---|
| `staff` | 39 |
| **`Manager`** | **15** |
| `admin` | 1 |

The code's role list is `['admin', 'manager', 'staff']` and comparisons are exact, so `Manager`
matches nothing.

**Today the impact is cosmetic**, because `@Roles('manager')` is not used on any route — only
`@Roles('admin')` is. It becomes a real access-control bug the moment manager permissions are
added, and those 15 people would silently have none of them.

Fix with a one-line update before that happens:

```sql
UPDATE users SET role = lower(role) WHERE role <> lower(role);
```

### G14. 51 existing files still have 400px previews

Images uploaded before the preview fix have 400×400 quality-75 thumbnails stored. Those cannot be
improved without reprocessing every file. The client works around it by using the original whenever
it is under 600 KB, which rescues most of them; larger old images stay soft. A backfill script
would fix them properly and does not exist.

---

## Repository and process

### G15. `README.md` and `.env.example` describe a system that no longer exists

Both still describe the pre-monorepo layout — `backend/` and `frontend/`, Express, Vite, local
Postgres and MinIO via Docker Compose. Every part of that is wrong. They are the first two files a
new joiner opens.

### G16. `main` cannot be deployed as it stands

57 commits behind `dev2`, and Vercel's production project builds it with Root Directory `frontend`,
a directory the monorepo removed. **Change the Vercel setting before merging**, not after. Details
in [05-deployment.md](05-deployment.md#before-main-can-ship).

### G17. The git remote has moved

`git remote set-url origin https://github.com/hairicle/message-app.git` still needs running on every
machine that pushes. Pushes currently succeed with a "repository moved" warning.

### G18. Vercel deploys are not gated on CI

`.github/workflows/deploy-staging.yml` runs the full suite before triggering Render. Vercel builds
from the same push independently and runs no tests, so a commit that fails CI still reaches the web
app. If that matters for production, disable Vercel's git integration and trigger it from the
workflow.

---

### G19. Unhandled type errors return 500

Found by the live security test. A request body whose field is the wrong *type* — an object, a
number or a boolean where a string is expected — reaches the code and throws, and the exception
filter answers 500.

| Request | Response |
|---|---|
| `POST /api/messages` with `ciphertext: {"$ne": null}`, `12345`, or `true` | **500** |
| `POST /api/users/me/password` with no `currentPassword` | **500** |
| `POST /api/messages` with `ciphertext: ["a","b"]` | **201 — accepted** |

Nothing changes state and nothing is bypassed — verified by probe: the password hash is untouched
and the old password still works. It matters because each of these is logged as a *server* fault,
which is how real ones get lost, and because the array case is type confusion reaching storage.

The fix is to validate these bodies with Zod; the exception filter already turns a `ZodError` into
a 400 with field names, and these endpoints simply are not using it. Full detail in
[07-security-test.md](07-security-test.md#s3--unhandled-type-errors-return-500).

---

## Summary

| | Count |
|---|---|
| Blocking before production | 1 (G1) |
| Security and operations | 4 (G2–G5) |
| Dead configuration | 1, covering 9 variables (G6) |
| Stubs and unbuilt features | 6 (G7–G12) |
| Data issues | 2 (G13–G14) |
| Repository and process | 4 (G15–G18) |
| Error handling | 1 (G19) |

The smallest set that makes production defensible: **G1** (hide the call buttons), **G2** (close
CORS), **G3** (rate-limit login), **G13** (fix the role casing), and **G16** (the Vercel setting).
Everything else can follow.
