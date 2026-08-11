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

### ~~G2. CORS accepts every origin~~ — FIXED

`main.ts` called `app.enableCors()` with no arguments and the gateway set `origin: true`, so both
reflected whatever Origin arrived. `CORS_ORIGIN` was set in `render.yaml` and named in the staging
walkthrough, and nothing read it.

Both now read it through one shared helper, `common/cors.ts`. Verified live: `evil.example.com`
gets no `Access-Control-Allow-Origin` on either the HTTP route or the socket handshake, and the web
app's own origin does. Detail in
[07-security-test.md](07-security-test.md#s2--cors-reflects-every-origin--fixed).

**`CORS_ORIGIN` is now a required production variable.** Unset, the API allows only localhost and
logs a warning — so a deployment that forgets it will find the web app cannot reach the API.

### ~~G3. Rate limiting is registered but never enforced~~ — FIXED

`ThrottlerModule` was configured but `ThrottlerGuard` was never bound as an `APP_GUARD`, so nothing
counted requests and the `@Throttle` decorators already on the login routes never fired. A live test
made 40 wrong-password attempts in 31.4 s without one being refused.

`AppThrottlerGuard` is now bound globally, counting a signed-in request against its token, a login
against the address *and* the account it names, and anything else against the address. That
distinction is what makes it safe here: the stock per-address guard would have given a whole office
one shared budget. The default was also raised to 300/min, because the unenforced 100 would have
rate-limited ordinary scrolling through a photo gallery. Detail and the trade-offs in
[07-security-test.md](07-security-test.md#s1--no-rate-limiting-anywhere-including-login--fixed).

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

### G6. Six environment variables have no effect

`CORS_ORIGIN` used to head this list and no longer belongs on it — it is now read, and required in
production. See G2.

| Variable | Reality |
|---|---|
| `FRONTEND_URL` | Loaded into config, read by nothing. |
| `MAX_FILE_SIZE_MB` | Loaded into `maxFileSizeBytes`, read by nothing. The real limit is `MAX_FILE_SIZE` in `modules/files/file-rules.ts` — one constant now, where it used to be written in three places. |
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

### ~~G19. Unhandled type errors return 500~~ — FIXED

Found by the live security test. A body field of the wrong *type* — an object, a number or a
boolean where a string was expected — reached the code and threw, and the filter answered 500.
Nothing changed state and nothing was bypassed, but each was logged as a *server* fault, and
`ciphertext: ["a","b"]` was worse than the rest: `Buffer.from` accepts an array, so it was stored.

`POST /api/messages`, `POST /api/users/me/password` and `PATCH /api/users/me` now parse their
bodies with Zod, and all five cases answer 400. Detail in
[07-security-test.md](07-security-test.md#s3--unhandled-type-errors-return-500--fixed).

A follow-up sweep found seven more endpoints of the same kind, and one worse thing: the socket
transport bypassed every schema on the HTTP controllers, so validation had to move into the service
both transports share. All fixed —
[08-file-and-input-test.md](08-file-and-input-test.md#findings--all-fixed).

### ~~G20. The upload size limit protects storage, not memory~~ — FIXED

multer was mounted with no `limits`, so the whole request body was buffered before the 50 MB check
ran. The limit is now on the interceptor as well as the validator, on attachments and both avatar
routes, so the stream is cut off when it is passed.

Measured by sampling the API process, because elapsed time is not the signal — the client keeps
sending after the server has stopped storing: **400 MB sent, 87 MB held**, answered 413. A
`MulterError` is not an `HttpException`, so the exception filter had to learn it too, or an
oversized upload would have been a 500.

### ~~G21. Nothing validates an uploaded file's declared content type~~ — FIXED

Whatever type a client claimed was stored and served back, and an SVG carrying a script was inert
only because Supabase chose to serve it as an attachment.

Nothing is rejected — an allowlist would be wrong about a colleague's work file every week — but a
declared type a browser would execute is now stored as `application/octet-stream`, so the file
downloads under its own name and can never render itself, whoever serves it.
[Detail](08-file-and-input-test.md#o2--nothing-validated-the-declared-content-type--fixed).

---

## Summary

| | Open | Fixed |
|---|---|---|
| Blocking before production | 1 (G1) | — |
| Security and operations | 2 (G4, G5) | 2 (G2, G3) |
| Dead configuration | 1, covering 8 variables (G6) | — |
| Stubs and unbuilt features | 6 (G7–G12) | — |
| Data issues | 2 (G13–G14) | — |
| Repository and process | 4 (G15–G18) | — |
| Error handling | — | 1 (G19), plus 8 more found by the input sweep |
| File handling | — | 2 (G20, G21) |

The smallest set that makes production defensible was **G1**, **G2**, **G3**, **G13** and **G16**.
Three are now closed and verified live. **What remains of that set:**

- **G1** — hide the call buttons. Still open, still the one that must not ship.
- **G13** — `UPDATE users SET role = lower(role) WHERE role <> lower(role);`
- **G16** — change Vercel's Root Directory to the repository root before `main` merges.

Everything else can follow.
