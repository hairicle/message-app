# Project Plan — Internal Messenger App

## Overview

A secure, self-hosted internal communications platform (Microsoft Teams / Slack-style)
giving the organization full control over data, access, and compliance — with no
third-party data access. Designed around a department/team hierarchy so each org unit
communicates in isolated workspaces.

---

## What's Been Built

### ✅ Phase 1 — Foundation & Authentication
- **Backend scaffold** — Node.js + Express, TypeScript (ESM), PostgreSQL, Redis
- **Auth system** — JWT tokens, LDAP/SSO integration (`ldapts`), 2FA via TOTP (QR code setup, enable/disable, two-step login)
- **Closed registration** — accounts created via admin panel or LDAP sync only; no public sign-up
- **User management** — profiles, avatar upload, display name, directory listing
- **Swagger UI** — API docs at `/api-docs` for backend testing

### ✅ Phase 2 — Core Messaging
- **Direct messages** — 1-on-1 chat with read receipts and delivery status
- **Group chats** — create groups, add/remove members, group admin roles
- **Channels** — broadcast-only; only owners/admins can post; anyone can subscribe/unsubscribe
- **Real-time engine** — Socket.IO with presence (online/offline), typing indicators
- **Message features** — edit, delete (soft), reply/quote, emoji reactions, pinned messages
- **Unread counts + last message preview** — in conversation sidebar
- **Message search** — full-text search within conversation or across all chats
- **Notification preferences** — per-user sound/desktop/email toggles
- **Conversation mute/unmute** — with duration (1h / 1d / 1w / forever)

### ✅ Phase 3 — File Sharing & Media
- **File uploads** — stored on MinIO (self-hosted S3-compatible); local disk fallback for dev
- **Image/video** — thumbnails (Sharp), inline preview, media gallery per chat
- **Voice notes** — record in-browser, upload as audio message, duration extraction
- **Link previews** — OG/Twitter Card metadata fetched server-side (SSRF-safe, fire-and-forget)
- **Read receipts per member** — see who read a message and when

### ✅ Phase 4 — Voice & Video Calls
- **WebRTC signalling** — SDP offer/answer and ICE candidate relay via Socket.IO
- **Call state management** — initiate, join, leave, end; call history per conversation
- **Peer-to-peer calls** — works for 1-on-1 and small groups (mesh topology, ≤4 people)
- **Push notification on incoming call** — notifies offline users via FCM

### ✅ Phase 5 — Mobile & Push
- **FCM push notifications** — sends push to offline recipients on every new message
  (checks Redis presence first — online users get Socket.IO; offline get push)
- **Offline message sync** — `GET /api/messages/undelivered` delivers queued messages on reconnect
- **Push token registration** — `PUT /api/users/me/devices/:id/push-token` stores FCM/APNs tokens

### ✅ Phase 6 — Teams / Workspaces
- **Teams** — department-scoped workspaces; conversations in a team are only visible to members
- **Auto-assignment** — users are automatically added to their department team on create/update/LDAP sync
- **Role-based teams** — admins auto-join "Admins" team; everyone joins "All Employees"
- **Announcement channels** — grouped by division in the Announcements panel
- **Channel discovery** — `GET /api/conversations/channels/all` lists all channels with `isSubscribed`

### ✅ Phase 7 — Admin Dashboard
- **Full-screen admin panel** — dark terminal design; tabs: Overview, Users, Departments, Audit Logs
- **Users CRUD** — create, inline-edit (name/username/email/role/department), disable/enable, delete
- **Excel import** — bulk-create users from `.xlsx`/`.csv`; template download; row-by-row error report
- **Disable user** — immediate session invalidation via Redis blocklist + Socket.IO disconnect
- **Delete user** — safe cascade: messages/files preserved (`SET NULL`), memberships removed (`CASCADE`)
- **Departments management** — add/rename/delete departments; rename cascades to `users.department` and team name
- **Department member view** — expand a department to see all members; assign/remove users
- **Audit logs** — filterable by action, user, date range; terminal-style log viewer
- **Platform stats** — total users, active users, messages, 24h messages, conversations
- **User profile panel** — click avatar → edit profile, change avatar, change password, manage 2FA, notification prefs

---

## Tech Stack

| Area | Choice |
|---|---|
| Backend | Node.js + Express (TypeScript, ESM) |
| Real-time | Socket.IO (WebSockets) |
| Database | PostgreSQL + Redis (presence/sessions/blocklist) |
| File storage | MinIO (self-hosted S3) with local disk fallback |
| Auth | JWT + LDAP (`ldapts`) + TOTP 2FA (`otpauth`) |
| Frontend | React + Vite + Tailwind CSS |
| Push | Firebase Admin SDK (FCM) |
| Excel | SheetJS (`xlsx`) |

---

## Schema Highlights

| Table | Purpose |
|---|---|
| `users` | Accounts with role (free text), department (text FK to departments.name) |
| `departments` | Managed list of department names; case-insensitive unique index |
| `teams` | Workspaces; scoped by department; case-insensitive unique index |
| `team_members` | User → team membership with role (owner/admin/member) |
| `conversations` | DMs / groups / channels, optionally scoped to a `team_id` |
| `messages` | Ciphertext (base64), soft-delete, edit history |
| `message_reactions` | Emoji reactions per user per message |
| `pinned_messages` | Pinned messages per conversation |
| `message_deliveries` | Per-device delivery/read status |
| `link_previews` | OG metadata cached after send |
| `notification_preferences` | Per-user sound/desktop/email flags |
| `audit_logs` | Login, password change, user create/delete events |
| `calls` / `call_participants` | Call records and participant list |

---

## What Remains

| Item | Priority | Notes |
|---|---|---|
| Docker / docker-compose setup | High | For production deployment |
| Email notifications (SMTP) | Medium | For `email_enabled` pref |
| mediasoup SFU | Low | Group calls >4 people |
| TURN/STUN (Coturn) | Low | NAT traversal for WebRTC |
| React Native mobile app | Future | Capacitor wrapper recommended |
| Monitoring (Prometheus/Grafana) | Future | Production observability |
| Signal Protocol (libsignal) | Future | True E2E encryption (DB tables ready) |

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `sethi` | My working branch (backend + frontend features) |
| `develop` | Integration branch — PRs merged here |
| `main` | Production — merged by lead only |

---

## Key API Endpoints

```
Auth:         POST /api/auth/login  ·  POST /api/auth/login/totp
              POST /api/auth/totp/setup  ·  POST /api/auth/totp/enable

Users:        GET/PATCH /api/users/me  ·  POST /api/users/me/avatar
              PUT /api/users/me/devices/:id/push-token

Teams:        GET/POST /api/teams  ·  GET /api/teams/:id/members
              POST /api/teams/:id/members

Convs:        GET/POST /api/conversations
              GET /api/conversations/channels/all
              POST/DELETE /api/conversations/:id/subscribe
              GET/POST/DELETE /api/conversations/:id/pins

Messages:     GET/POST /api/messages  ·  GET /api/messages/search
              POST /api/messages/:id/reactions  ·  GET /api/messages/:id/receipts
              GET /api/messages/undelivered

Files:        POST /api/files  ·  POST /api/files/voice

Calls:        POST /api/calls  ·  POST /api/calls/:id/join
              POST /api/calls/:id/leave  ·  POST /api/calls/:id/end

Departments:  GET/POST /api/departments  ·  PATCH/DELETE /api/departments/:id

Admin:        GET /api/admin/stats  ·  GET /api/admin/audit-logs
              PATCH /api/admin/users/:id  ·  DELETE /api/admin/users/:id
              POST /api/admin/users/import  ·  POST /api/admin/sync-department-teams
```
