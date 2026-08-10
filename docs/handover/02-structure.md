# 2 — Project structure

## The repository

One npm workspace root: a single `package-lock.json`, one `npm ci`, then per-workspace commands.
There is no Lerna, Nx or Turborepo.

```
messenger-app/
├── apps/
│   ├── api/                  NestJS API + Socket.IO gateway
│   └── web/                  Next.js App Router client
├── packages/
│   └── shared/               TypeScript types shared by both apps
├── docs/                     This handover, plus the staging walkthrough and DB design
├── db/                       Original SQL schema (superseded by Prisma migrations)
├── .github/workflows/        CI and the staging deploy
├── render.yaml               Render Blueprint for the API service
├── vercel.json               Vercel build config for the web app
├── docker-compose.yml        Local Postgres + Redis only — not used in deployment
└── package.json              Workspace root
```

## Build order — this is the part that bites

`apps/api` and `apps/web` both import `@messenger/shared`, which resolves to
`packages/shared/dist/`. That directory is **not committed**. Building either app before compiling
shared fails with an unresolved import.

```
packages/shared  ──▶  apps/api
                 └─▶  apps/web
```

Every build path already accounts for this, and each does it differently — that is the thing to
check when a new pipeline is added:

| Path | How shared gets built |
|---|---|
| `npm run build` (root) | Explicitly, first, in the script |
| `apps/api/Dockerfile` | Explicit `RUN npm run build --workspace=packages/shared` before the API build |
| `vercel.json` | Explicit, in `buildCommand` |
| `.github/workflows/ci.yml` | Explicit "Build shared types" step |

**Vercel's Root Directory must be the repository root, not `apps/web`.** Pointed at `apps/web`,
Vercel runs a bare `next build`, which does not build the workspace, and the deploy fails on the
missing `@messenger/shared`.

One more ordering constraint on the API side: the API's types come from the generated Prisma
client, so `npx prisma generate` must run before any type-check, test or build of `apps/api`. It
needs no database connection.

## `apps/api`

```
apps/api/
├── certs/
│   └── supabase-prod-ca-2021.crt   Pinned CA. Deleting it stops the API booting — by design.
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 0000_baseline_existing_schema
│       ├── 0001_pin_conversations
│       └── 0002_user_last_seen
├── scripts/
│   └── seed-admin.ts               Creates the first administrator
├── src/
│   ├── main.ts                     Bootstrap: helmet, CORS, /api prefix, filters, port
│   ├── app.module.ts               Root module — every feature module is registered here
│   ├── config/env.config.ts        Environment variable loading and required-var checks
│   ├── database/                   PrismaService, pooled pg connection, CA pinning
│   ├── redis/                      ioredis client with reconnection handling
│   ├── realtime/realtime.gateway.ts  The Socket.IO gateway — all realtime lives here
│   ├── health/                     GET /health
│   ├── common/
│   │   ├── guards/                 JwtAuthGuard, RolesGuard
│   │   ├── filters/                HttpExceptionFilter
│   │   ├── account-status.service.ts  Role + disabled-account cache, backed by Redis
│   │   └── avatar-*.ts             Signed-URL generation and caching for avatars
│   ├── modules/
│   │   ├── auth/                   Login, TOTP setup and verification
│   │   ├── users/                  Profile, directory, admin user CRUD
│   │   ├── conversations/          Conversations, members, pins, mutes, group avatars
│   │   ├── messages/               Send, edit, delete, react, search, forward, bookmark
│   │   ├── files/                  Upload, thumbnails, signed download URLs
│   │   ├── admin/                  Stats, role changes, audit log
│   │   ├── departments/            Department CRUD
│   │   ├── teams/  tasks/  meetings/  calls/   Routable, but no UI yet
│   └── testing/prisma-mock.ts      Test double for PrismaService
└── Dockerfile                      Two-stage; this is what Render builds
```

**Where realtime lives.** Services do not import the gateway — that would be a circular module
dependency. Instead each service owns an `EventEmitter` (`service.events`) and the gateway
subscribes to it at startup. If a message is created anywhere — socket, HTTP, or a forward — it
emits once and the gateway relays it. This is worth knowing because it is the mechanism that keeps
the socket and HTTP send paths from diverging, and a new service that skips it will deliver to
nobody.

## `apps/web`

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx              Root layout, fonts, theme
│   │   ├── page.tsx                Redirects to login or chat
│   │   ├── (auth)/login/           Sign-in, including the TOTP step
│   │   └── (main)/chat/page.tsx    The whole application shell — nav rail, section switching
│   ├── components/                 MessageThread, ConversationList, AdminDashboard, dialogs…
│   ├── context/                    AuthContext, SocketContext, ThemeContext
│   ├── hooks/                      useFileBlobUrl, useWaveform
│   ├── lib/api/                    One module per API area; client.ts holds fetch + auth header
│   └── utils/                      Pure functions — grouping, albums, mentions, compression…
└── next.config.ts
```

`MessageThread.tsx` is by far the largest file and carries the thread rendering, the composer,
staged attachments, the outbox, pagination and bulk selection. Everything in `utils/` is a pure
function extracted out of it and unit-tested; that is where to look first when something in the
thread misbehaves.

## `packages/shared`

Types only — no runtime code today. It compiles with plain `tsc` to `dist/` and both apps consume
it as a workspace dependency. Adding a runtime export here means every consumer needs shared built
before it runs, including in development.

## Ports

| Process | Port | Set by |
|---|---|---|
| API | `PORT`, default **4000** | `main.ts`; Render assigns `PORT` |
| Web (dev and `next start`) | **3100** | `apps/web/package.json` |

Note the mismatch to be aware of: the unused `FRONTEND_URL` config default and parts of the older
docs say `3000`. The web app actually listens on **3100**.

## Test and build commands

Run from the repository root:

```bash
npm ci --legacy-peer-deps                       # --legacy-peer-deps is required
npm run build --workspace=packages/shared       # always first
npx prisma generate --schema apps/api/prisma/schema.prisma

npm test                                        # both suites — 332 tests
npm run build                                   # shared, then api, then web
```

Current test counts: **165 API tests**, **167 web tests**. All green on `dev2` at `8395080`.

`npm ci` without `--legacy-peer-deps` fails on a peer dependency conflict. Every pipeline in the
repository already passes the flag; a new one must too.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production. **Currently 36 commits behind and not deployable — see [05-deployment.md](05-deployment.md#before-main-can-ship).** |
| `dev2` | Active development. Everything current lives here. |
| `staging` | What the staging environment builds from |
| `develop`, `sethi`, `fix/bugs`, `feature/*` | Older or in-flight work |
