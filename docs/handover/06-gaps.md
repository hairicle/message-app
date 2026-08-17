# 6 — Gaps register

Everything known to be missing, stubbed, dead or broken, in severity order. Compiled by auditing
the code on `dev2` at `9b46aab`, not from a backlog — several of these are not tracked anywhere
else.

Each entry says what is wrong, how it shows up, and what closing it involves.

---

## Blocking — nothing outstanding

### ~~G1. The audio and video call buttons do not work, and leave the camera on~~ — REMOVED

**This entry was out of date and said so for longer than it should have.** By the time it came to
be fixed, the buttons had already been put behind `{false && …}` with a comment saying to flip it
when calling was ready — so the camera problem described below was no longer reachable. The register
kept reporting it as live. Recorded because a stale gap register is worse than none: it spends
attention on something already handled and, next time, earns less trust for something that is not.

What was true, and what the entry got right, is that the code underneath was not a working
implementation and read like one:

- The client and server spoke **different, non-overlapping protocols** — the client emitted
  `call:start` / `call:end` and listened for `call:incoming` / `call:ended`; the gateway handled
  `call:offer` / `call:answer` / `call:ice-candidate` / `call:reject` and emitted the same four
  back. Only `call:reject` appeared on both sides, with payloads that disagreed.
- `new RTCPeerConnection` was **never called anywhere**. `peerConnectionRef` was declared and never
  assigned, so there was no media path at all.
- No TURN or STUN server was configured, so correct signalling still would not have connected two
  people on different networks.
- The four gateway relays checked that the *sender* belonged to the named conversation but never
  that the **target** did, so a member of any conversation could push an arbitrary payload to any
  user id in the system. Inert while no client listened; live the moment one did.

**Removed rather than left behind a flag.** Someone who finds an empty space writes calls from
scratch and gets it right. Someone who finds this spends two days making two incompatible halves
talk before realising neither was finished — and a `false` waiting to be flipped is an invitation
to restore the camera bug. Git history keeps all of it.

Gone: the header buttons, the incoming-call banner, `startCall` / `answerCall` / `rejectCall` /
`endCall`, `localStreamRef`, `peerConnectionRef`, the call state and its socket listeners, and the
four gateway relay handlers. About 130 lines.

Kept: the `calls` and `call_participants` tables, and the three `/api/calls` routes, which only
record history. Dropping tables is a migration for no benefit. They remain on the list of routes
with no UI in front of them (G10).

**If calls are wanted as a feature**, the expensive part is not the code: TURN is not optional —
two people on different networks will not connect peer-to-peer, and a relay carries the media and
its bandwidth cost. Group calls are a different architecture again. For an internal tool, a hosted
provider gets there in days where hand-rolled WebRTC is weeks.

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

### ~~G4. The API cannot run more than one instance~~ — FIXED

Socket.IO rooms lived in one process's memory, so two instances both looked healthy while two
people who happened to land on different ones never saw each other's messages. Nothing errored —
that silence is what made it worth fixing before anyone scaled rather than after.

`RedisIoAdapter` now puts room broadcasts on Redis pub/sub. It degrades rather than fails: with
Redis unreachable the server still delivers within its own process, which is exactly right on a
single instance and no worse than before on several.

**Verified by running two instances**, connecting a client to each, and sending between them —
messages and typing indicators both cross. Detail in
[10-scaling-and-encryption.md](10-scaling-and-encryption.md).

### ~~G5. Messages are not encrypted~~ — FIXED, with a precise caveat

The column named `ciphertext` held base64 — an encoding, not a cipher. Bodies are now encrypted
with AES-256-GCM before they are stored.

**This is encryption at rest, not end-to-end.** The key is on the server, so the running API can
read messages and so can anyone holding both the database and the key. What it removes is the far
more likely exposure: a dump, a backup, a leaked connection string, or the hosting provider's staff
reading the table. Do not describe the system as end-to-end encrypted — that remains unbuilt, and
[10-scaling-and-encryption.md](10-scaling-and-encryption.md#why-this-is-not-end-to-end) says what it
would cost.

Rows written before this still read correctly, so it was deployable without downtime.
`npm run encrypt:messages` converts them.

**`MESSAGE_ENCRYPTION_KEY` is now a required production variable.** Without it the API runs and
stores plaintext, warning at startup.


---

## Dead configuration

### ~~G6. Six environment variables have no effect~~ — REMOVED

They no longer exist to have no effect. `env.config.ts` declared thirty settings and **nothing read
any of them** — every consumer reaches for its own variable directly through
`ConfigService.get('STORAGE_ENDPOINT')` or `process.env`. The namespace had become a second, silent
source of truth naming LDAP, Firebase and MinIO settings for features that do not exist.

It now declares only the three the API refuses to start without, which is the one thing it was
actually doing. `ldapts`, `firebase-admin`, `class-validator`, `class-transformer` and `cors` were
uninstalled with it — five packages that shipped in the production image for nothing.

`MAX_FILE_SIZE_MB` and `UPLOADS_DIR` are gone from the config too. The real limit is
`MAX_FILE_SIZE` in `modules/files/file-rules.ts`; there is no local upload directory any more.

**`firebase-admin` has since come back**, and properly this time: push notifications use it, and
`FIREBASE_SERVICE_ACCOUNT_JSON` is read. It is loaded dynamically, so a deployment that has not
configured push still pays nothing for it. See G11.

Nothing is left declared-and-unread. The `LDAP_*` names went with the rest — `grep -rn "LDAP_"`
over the API finds nothing, so there is no longer a setting whose presence implies a feature.

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

### ~~G11. Push notifications are not built~~ — SERVER DONE, CLIENT PENDING

**The server side is built.** `POST /api/push/token` registers a device, sending hangs off the
messages emitter, and mute, a new `push_enabled` preference and the sender themselves are all
respected. The payload deliberately omits the message text. Unconfigured it is a no-op that warns
once at startup. Detail in [13-android-app.md](13-android-app.md).

**Nothing consumes it yet.** No notification has been delivered to a real device, because that needs
Firebase credentials and a phone — set `FIREBASE_SERVICE_ACCOUNT_JSON` and the first send is the
test.

For the **web**, this changes nothing: in-browser notifications work while a tab is open, and a
closed tab still gets nothing. Reaching a closed browser tab needs a service worker, which is a
separate piece of work from the mobile push above.

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

### ~~G18. Vercel deploys are not gated on CI~~ — FIXED

Vercel built from its own Git integration on the same push, so the web app was the one thing that
shipped without the tests having passed — a commit that failed CI still reached users.

`deploy-staging.yml` now has a `deploy-web` job that needs `verify`, builds with the Vercel CLI
and deploys the prebuilt output. Building in CI also means what ships is the exact tree the tests
ran against.

**This only holds while Vercel's own Git integration is off** for the project — Settings → Git →
Ignored Build Step set to `exit 0`, or the repository disconnected. With both enabled every push
deploys twice and the ungated one can win. Three secrets are needed: `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; the job fails with a legible message naming any that are
missing rather than deploying nothing quietly.

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
| Blocking before production | — | 1 (G1) |
| Security and operations | — | 4 (G2–G5) |
| Dead configuration | 1, covering 8 variables (G6) | — |
| Stubs and unbuilt features | 6 (G7–G12) | — |
| Data issues | 2 (G13–G14) | — |
| Repository and process | 3 (G15–G17) | 1 (G18) |
| Error handling | — | 1 (G19), plus 8 more found by the input sweep |
| File handling | — | 2 (G20, G21) |

The smallest set that makes production defensible was **G1**, **G2**, **G3**, **G13** and **G16**.
Four are now closed. **What remains of that set:**

- **G13** — `UPDATE users SET role = lower(role) WHERE role <> lower(role);`
- **G16** — change Vercel's Root Directory to the repository root before `main` merges.

Everything else can follow.
