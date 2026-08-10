# 3 — How it works

This document is about runtime behaviour: what talks to what, over which protocol, and what breaks
when a piece is missing. It is written for whoever has to diagnose the system at 2am, not for
whoever writes the next feature.

## The moving parts

```
                    ┌──────────────────────────────────────────┐
   Browser ─────────┤  Vercel — Next.js (static + SSR)         │
      │             └──────────────────────────────────────────┘
      │                       serves the bundle only; no data
      │
      ├── HTTPS  ─────────────┐
      │  (REST, /api/*)       │
      │                       ▼
      │             ┌──────────────────────────────────────────┐
      └── WSS ──────┤  Render — NestJS API + Socket.IO         │
         (socket.io)└────┬──────────────┬──────────────┬───────┘
                         │              │              │
                         ▼              ▼              ▼
                  ┌────────────┐ ┌────────────┐ ┌────────────────┐
                  │ Supabase   │ │  Upstash   │ │ Supabase       │
                  │ PostgreSQL │ │   Redis    │ │ Storage (S3)   │
                  └────────────┘ └────────────┘ └────────────────┘
                   messages,       presence,      attachments,
                   users, files    block list,    avatars
                   metadata        TOTP replay    (private buckets)
```

The browser talks to the API directly — Vercel is not a proxy. That is why the API's origin has to
be correct at **web build time**, and why a WebSocket failure shows up even when HTTP works.

## Startup and failure modes

The API refuses to start without `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET` — `env.config.ts`
throws by name for whichever is missing, so the boot log tells you which one.

It also refuses to start if `apps/api/certs/supabase-prod-ca-2021.crt` is missing. That is
deliberate: the alternative is silently connecting to the database without verifying its
certificate.

| If this is down | What happens |
|---|---|
| **Postgres** | Everything fails. No degraded mode. |
| **Redis** | The API stays up. `ioredis` retries with backoff (500 ms × attempt, capped at 10 s) and logs at most one error per 30 s. Presence goes stale and the disabled-account block list falls back to a database read. This was previously fatal and is now survivable — worth knowing before you page someone. |
| **Supabase Storage** | Messaging works; uploads fail and existing images do not load. |
| **The API** | The web app loads and then shows failures on every request. Vercel is unaffected. |

## Sign-in

```
POST /api/auth/login   { email, password }
   │
   ├─ user not found, or wrong password ──▶ 401 (deliberately the same message for both)
   ├─ status != 'active'                 ──▶ 403 "Account is disabled"
   │
   ├─ 2FA off  ──▶ 200 { token, deviceId, user }
   │
   └─ 2FA on   ──▶ 200 { requiresTotp: true, totpToken }
                        │  totpToken: scope 'totp_pending', 5 minute expiry, carries a jti
                        ▼
                  POST /api/auth/login/totp   { totpToken, code }
                        │
                        ├─ jti already in Redis ──▶ 401 (replay blocked)
                        └─ code valid           ──▶ 200 { token, deviceId, user }
                                                     and the jti is written to Redis for 300 s
```

Passwords are bcrypt at cost 12. The full token's lifetime is `JWT_EXPIRES_IN` (staging uses `8h`).

The browser stores the token and sends it as `Authorization: Bearer <token>` on REST calls, and as
`socket.handshake.auth.token` on the WebSocket.

## What every authenticated request goes through

`JwtAuthGuard` runs on all of it:

1. Verify the JWT signature and expiry.
2. **Reject `scope: 'totp_pending'` tokens** — a half-authenticated token must not reach real
   routes.
3. `AccountStatusService.assertActive(userId)` — an in-process cache in front of a Redis key
   `disabled:user:<id>`, falling back to the database.

`RolesGuard` runs after it on admin routes and reads the user's **current** role from
`AccountStatusService`, not from the JWT. A demotion therefore takes effect immediately rather than
when the token expires.

The socket handshake applies the same three checks. Skipping them there was a real hole: disabling
an account used to cut off HTTP while the open socket kept delivering messages.

## Sending a message

Two transports, one delivery path.

```
   Socket connected?
        │
   yes  ├──▶ socket.emit('message:send', …)  with a 12 s ack timeout
        │         │
        │         └── no ack in 12 s ──▶ falls back to the HTTP path below
        │
   no   └──▶ POST /api/messages
                  │
                  ▼
        MessagesService.sendMessage()
                  │  writes the row, then:
                  ▼
        service.events.emit('message:new', message)
                  │
                  ▼
        RealtimeGateway relays to room `conversation:<id>`
                  │
                  ▼
        every connected member receives 'message:new'
```

The emit happens in the service, not in the socket handler. That is the whole point: a message
created over HTTP, over the socket, or by a forward all reach recipients identically. When this
was only wired into the socket handler, HTTP sends delivered to nobody until the recipient
reloaded.

**Offline sends** are queued client-side and flushed on reconnect. Socket.IO buffers emits on a
disconnected socket without ever failing them, so the client checks `socket.connected` before
emitting rather than trusting the emit.

## Socket rooms

| Room | Joined when | Used for |
|---|---|---|
| `user:<userId>` | At connection, before anything else | Per-user events: new conversation, removal, forced disconnect |
| `conversation:<id>` | At connection, for every conversation the user is in | Messages, reactions, read receipts, typing |

A conversation created while you are already online would otherwise never have its room joined —
you would receive nothing from it until a reload. The gateway listens for
`conversation:created` and joins the affected sockets at that moment.

The per-user room is joined **before** the conversation lookup, deliberately: that lookup is a
database round-trip, and a disable landing during it would find the room empty and leave the socket
alive.

## Presence

- On connect: a Redis key `presence:user:<id>` is set, and `presence:update` is broadcast.
- On disconnect: only when the **last** socket for that user closes does the API write
  `users.last_seen_at` and broadcast `offline`. Closing one of three tabs is not leaving.
- `presence:get` returns a snapshot, for a client that just connected.

Presence therefore lives in Redis, not Postgres. A Redis flush shows everyone as offline until they
reconnect; it loses nothing permanent.

## Uploading a file

```
POST /api/files   multipart, field name "file"
   │
   ├─ over 50 MB ──▶ 400
   │
   ├─ image? ──▶ sharp: .rotate() → resize to 1280 inside → JPEG q82 mozjpeg
   │              └──▶ uploaded to  <bucket>/thumbnails/<key>
   │
   ├─ original uploaded to  <bucket>/<uuid><ext>
   │
   └─ row written to `files`, returns { file: { id, fileName, mimeType, sizeBytes, hasThumbnail, … } }

Then: POST /api/messages { conversationId, type: 'image', fileId }
```

Reading it back:

```
GET /api/files/:id            ──▶ 302 redirect to a signed Supabase URL (300 s)
GET /api/files/:id/thumbnail  ──▶ 302 redirect to a signed URL for the preview
GET /api/files/:id/meta       ──▶ JSON metadata
```

Both redirect routes check that the requester is a member of a conversation the file was sent in
before signing anything. **The buckets must be private** — Supabase creates buckets public by
default, and a public bucket hands out permanent unauthenticated links to every attachment, which
is exactly what the signed-URL design removes.

`.rotate()` in the pipeline applies EXIF orientation; without it, portrait photos from phones
preview sideways.

## Client-side image handling

When a user attaches a photo the composer asks how to send it:

- **As a photo** — re-encoded in the browser, capped at 2048px, quality 0.85. If the re-encode is
  not smaller than the original, the original is kept.
- **As a file** — byte-identical, no processing.

Independently of that choice, the thread displays the server's 1280px preview for any image, unless
the original is under 600 KB, in which case the original is used directly — nothing is saved by
shrinking something already small.

## Deleting and disabling

Disabling an account through the admin dashboard does three things, in this order:

1. Sets `status = 'disabled'` in Postgres.
2. Writes `disabled:user:<id>` to Redis, so every API instance sees it without a database read.
3. Emits an internal event that the gateway turns into
   `io.in('user:<id>').disconnectSockets(true)` — live sockets drop immediately.

The API refuses to let an administrator demote, disable or delete their own account. That check
exists because it is otherwise possible to lock the last administrator out of the system with a
single click.

## Audit logging

Administrative actions write to the `audit_logs` table: role changes, disables, deletions, user
creation. This was silently dead for a period after the NestJS refactor and has been restored —
if you are asked to produce an audit trail, records before that repair do not exist.
