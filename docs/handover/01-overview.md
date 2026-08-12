# 1 — Overview

## What it is

An internal messaging platform for company staff — direct messages and group chats, with file and
image sharing, voice notes, reactions, replies, forwarding, pinning, mentions and read receipts.
Closed registration: there is no public sign-up, accounts are created by an administrator.

It is deliberately self-hosted rather than a SaaS subscription, so message content, attachments and
the user directory stay under company control.

## What is actually shipped

The navigation shows four areas. Only two of them do anything today.

| Area | Status | Notes |
|---|---|---|
| **Chat** | Live | Direct messages and groups. This is the whole product right now. |
| **Dashboard** | Live, admin only | User management, roles, enable/disable, audit log. Hidden from non-admins in the UI, and every endpoint behind it is `@Roles('admin')`. |
| **Teams** | Placeholder | Phase 2. The nav entry renders a "coming soon" panel. |
| **Announce** | Placeholder | Phase 3. Same. |

The placeholders are driven by a single map, `COMING_SOON`, in
[`apps/web/src/app/(main)/chat/page.tsx`](../../apps/web/src/app/%28main%29/chat/page.tsx) — deleting
an entry turns that feature on. **Note for capacity planning:** the API endpoints behind Teams
(`/api/teams`), tasks, meetings and calls already exist and are routable; only the UI is withheld.

## Feature list

Everything below is implemented and covered by tests or live verification.

**Messaging**
- Direct messages (deduplicated by pair — messaging the same person twice reuses the conversation)
- Group chats, minimum three people including the creator
- Real-time delivery over WebSocket, with an HTTP fallback that reaches the same recipients
- Offline send queue — messages composed while disconnected are held and flushed on reconnect
- Edit (author), reply, forward
- Delete — **administrators only**, by policy; the button is hidden for everyone else
- Reactions, with a per-emoji list of who reacted
- Read receipts, per-user in groups
- @mentions
- Pin messages, bookmark messages
- Full-text search across messages
- Message pagination, 50 per page

**Attachments**
- Images, video, arbitrary files, up to 50 MB
- Send-as-photo (client-side compressed, capped 2048px) or send-as-file (byte-identical original)
- Server-generated 1280px preview for images, EXIF orientation applied
- Voice notes with a waveform and playback speed control
- Multi-image album layout
- A per-conversation media / files / voice gallery

**Conversations**
- Pin, mute, leave (groups)
- Group avatar upload with cropping
- Member add/remove, member profile view
- Right-click context menu on the conversation list

**Accounts and access**
- Email + password sign-in, bcrypt cost 12
- Optional TOTP two-factor, with replay protection
- Three roles: `admin`, `manager`, `staff`
- Admin dashboard: create, edit, disable, delete users; change roles; audit log
- Instant revocation — disabling an account drops its live WebSockets, it does not wait for the
  token to expire
- Presence (online/offline) and last-seen
- Typing indicators
- Light and dark theme

**Not built yet:** end-to-end encryption (the schema has Signal Protocol tables, unused), link
previews (rendered, never generated), mobile apps, push notifications to a closed tab (in-browser
notifications do work), LDAP sign-in, bulk user import.

The full register of what is missing, stubbed, dead or broken — and what has since been closed — is
[06-gaps.md](06-gaps.md).

## Technology

| Layer | Choice | Version |
|---|---|---|
| API framework | NestJS | 11 |
| API runtime | Node | 20 (pinned by the Dockerfile) |
| ORM | Prisma with the `PrismaPg` driver adapter | 7.9.1 |
| Realtime | Socket.IO | 4.8 |
| Auth | passport-jwt, bcryptjs, otpauth (TOTP) | — |
| Image processing | sharp | 0.35 |
| Web framework | Next.js App Router | 16.3 |
| UI | React 19, Tailwind CSS v4 | — |
| Database | PostgreSQL, hosted on Supabase | — |
| Cache / presence | Redis, hosted on Upstash | — |
| Object storage | Supabase Storage, private buckets + signed URLs | — |

## Where it runs

| Component | Platform | Built from |
|---|---|---|
| API | Render, Docker | `apps/api/Dockerfile` |
| Web | Vercel | `vercel.json`, root directory = repository root |
| Database + storage | Supabase | — |
| Redis | Upstash | — |

Staging's Render service is on the free plan (`render.yaml`), where instances sleep after
inactivity and take ~30 s to answer the first request. Confirm the production service's plan in the
dashboard — see [05-deployment.md](05-deployment.md#sizing-and-tier-notes).

The API **can** now run more than one instance: socket rooms are shared through Redis. That was a
hard limit until recently — see [10-scaling-and-encryption.md](10-scaling-and-encryption.md).

## Security posture

Worth knowing before you sign off on the deploy:

- **Transport to the database is certificate-pinned.** The API verifies Supabase's certificate
  against `apps/api/certs/supabase-prod-ca-2021.crt` and fails closed if it is absent — it will not
  silently fall back to an unverified connection.
- **Storage buckets are private.** Attachments and avatars are served through short-lived signed
  URLs (300 s), never public links.
- **Authorisation is enforced server-side, not in the UI.** Role checks read the current role from
  the database via a cached lookup, not from the JWT, so a demotion takes effect without waiting for
  the token to expire.
- **Disabled accounts are blocked through Redis** as well as the database, and live sockets are
  disconnected immediately.
- **Message bodies are encrypted at rest** with AES-256-GCM. **This is not end-to-end encryption**
  — the key is on the server, so the running API can read every message, and so can anyone holding
  both the database and the key. It removes the likelier exposure: a dump, a backup, a leaked
  connection string. Do not describe the system as end-to-end encrypted to stakeholders; that
  remains unbuilt. See [10-scaling-and-encryption.md](10-scaling-and-encryption.md#why-this-is-not-end-to-end).
- **CORS is restricted** to the configured origin, on both the HTTP routes and the socket
  handshake. Local addresses are additionally allowed outside production.
- **Rate limiting is enforced** — 300 requests a minute per token, and sign-in is capped per address
  *and* account so one person being guessed at cannot lock out a colleague.
