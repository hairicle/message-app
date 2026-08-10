# 5 — Production deployment

Staging is already running and its build-out is documented step by step in
[../staging-deploy.md](../staging-deploy.md). **Read that first** — production follows the same
sequence with the same constraints. This document covers what production adds: the full variable
reference, what must not be shared with staging, the blockers on `main`, and the gaps to close
before going live.

## Known gaps — read before going live

Four things found while writing this handover. None of them are hypothetical; each was confirmed by
reading the code.

### 1. CORS is open to every origin

`main.ts` calls `app.enableCors()` with no arguments, which reflects whatever `Origin` the request
carries. The Socket.IO gateway is the same: `cors: { origin: true }`.

`CORS_ORIGIN` appears in `render.yaml` and in the staging walkthrough, but **nothing in the code
reads it**. Setting it has no effect.

Any website a signed-in user visits can therefore call this API from their browser. Requests still
need the bearer token, and the token lives in browser storage rather than a cookie, so this is not
directly a CSRF hole — but it removes a layer that should be there and it is a finding any security
review will raise. The fix is a one-line change in `main.ts` and one in the gateway decorator to
read the variable that is already being set.

### 2. Rate limiting is configured but not enforced

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` is registered in `app.module.ts`, but
`ThrottlerGuard` is never bound as an `APP_GUARD`, so no request is ever counted. **The login
endpoint is unthrottled**, which matters most: password guessing is limited only by bcrypt's cost.

Put a rate limit at the edge (Cloudflare, or Render's own) before going live, or bind the guard.

### 3. `FRONTEND_URL` and `MAX_FILE_SIZE_MB` do nothing

`FRONTEND_URL` is loaded into config and never read. `MAX_FILE_SIZE_MB` is read into
`maxFileSizeBytes` and never read either — the real limit is a hard-coded 50 MB in both
`files.controller.ts` and `files.service.ts`. Changing the variable will not change the limit; you
have to change the code.

### 4. Messages are not encrypted

The column is called `ciphertext`, but it stores base64-encoded plaintext. Anyone with database
access — including Supabase support and anyone holding the service key — can read every message.
The Signal Protocol tables in the schema are unused.

This is a known Phase 3 item, not a defect. It matters here because the project is described
internally as "secure, self-hosted, full control over encryption keys", and the encryption part is
not built. Make sure whoever signs off knows that.

## Before `main` can ship

`main` is **57 commits behind `dev2`** and its current state does not build in the deployed
configuration.

- Vercel's production project builds `main` with **Root Directory `frontend`** — a directory the
  monorepo removed. That build breaks the moment the monorepo lands on `main`.
- **Fix this in Vercel *before* merging**: set Root Directory to the **repository root** and set
  `NEXT_PUBLIC_API_URL`. Staging already runs this configuration, so it is proven.
- There is one more manual step outstanding: the git remote reports the repository has moved. Run
  `git remote set-url origin https://github.com/hairicle/message-app.git` on any machine that
  pushes.

## Environment variables

Authoritative list. `.env.example` in the repository root is stale and describes a different
stack — ignore it.

### API (Render) — required

The API throws at startup, naming the variable, if any of these three is missing.

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://…@…pooler.supabase.com:6543/postgres?pgbouncer=true` | Pooled. The `?pgbouncer=true` suffix is required. |
| `REDIS_URL` | `rediss://…upstash.io:6379` | |
| `JWT_SECRET` | 64 random hex chars | **Never share with staging.** Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |

### API — required in practice

Missing these does not stop the boot, but files and migrations break.

| Variable | Example | Notes |
|---|---|---|
| `DIRECT_URL` | `postgresql://…:5432/postgres?sslmode=verify-full&sslrootcert=./certs/supabase-prod-ca-2021.crt` | Migrations only. **Keep the ssl suffix.** |
| `SUPABASE_SERVICE_KEY` | service role key | Signs storage URLs |
| `STORAGE_ENDPOINT` | `https://<project-ref>.supabase.co/storage/v1/s3` | |
| `STORAGE_BUCKET` | `messenger-files` | |
| `AVATAR_BUCKET` | `avatars` | |
| `STORAGE_REGION` | `ap-southeast-1` | |

### API — optional

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Render assigns this |
| `NODE_ENV` | — | Set to `production` |
| `JWT_EXPIRES_IN` | `1h` | Staging uses `8h` |
| `TOTP_ISSUER` | `InternalMessenger` | Name shown in authenticator apps |

### API — set but inert

Listed so nobody wastes time tuning them: **`CORS_ORIGIN`, `FRONTEND_URL`, `MAX_FILE_SIZE_MB`,
`UPLOADS_DIR`**, and every `LDAP_*` and `FIREBASE_*` variable. No code path reads any of them.

### Web (Vercel)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | The public API origin, e.g. `https://messenger-api.onrender.com`. **Inlined at build time** — changing it requires a redeploy, not a restart. |

### GitHub Actions

| Secret | Notes |
|---|---|
| `RENDER_DEPLOY_HOOK_API` | A deploy hook scoped to the one service. Render's own auto-deploy is off so this workflow is the only thing that ships. |

## The ordering constraint

The two deploys depend on each other and cannot be done in parallel:

```
   Vercel build  ──needs──▶  the API's URL      (NEXT_PUBLIC_API_URL, baked in at BUILD time)
   Render API    ──needs──▶  the web's origin   (runtime — and see gap 1, currently unused)
```

Because Vercel's dependency is a *build* input: **deploy the API first, then build the web against
its URL.** The other order produces a bundle that calls `localhost:4000`, and no amount of changing
environment variables fixes it — only a rebuild does.

## Deploy sequence

1. **Provision** a Supabase project and an Upstash database, both separate from staging, both in
   Singapore to sit near the API.
2. **Create two storage buckets**, `messenger-files` and `avatars`. **Set both private.** Supabase
   creates buckets public by default, and a public bucket hands out permanent unauthenticated links
   to every attachment.
3. **Apply migrations** from a machine with the repository:
   ```bash
   cd apps/api
   DIRECT_URL="postgresql://…:5432/postgres?sslmode=verify-full&sslrootcert=./certs/supabase-prod-ca-2021.crt" \
     npx prisma migrate deploy
   ```
   Run it from `apps/api` — the `sslrootcert` path is relative to that directory. Check the URL
   before you press enter; nothing distinguishes production from staging for you.
4. **Seed the first admin** — a fresh database has no accounts and nothing can sign in:
   ```bash
   cd apps/api && SEED_ADMIN_EMAIL=you@company.com npm run seed:admin
   ```
   It prints a generated password once. Re-running never overwrites an existing account, so it is
   safe if you are unsure whether it has been done.
5. **Deploy the API** on Render: Docker, `apps/api/Dockerfile`, context `.`, health check
   `/health`, auto-deploy **off**. Set the variables above. Confirm `/health` answers.
6. **Deploy the web** on Vercel: Root Directory = **repository root**, `NEXT_PUBLIC_API_URL` = the
   Render URL from step 5. The build command comes from `vercel.json`.
7. **Wire the deploy hook** into `RENDER_DEPLOY_HOOK_API`.
8. **Smoke test** — see [04-api-reference.md](04-api-reference.md#smoke-test). The two-tab message
   test is the one that matters.

## Migrations

Three exist. A database that has only had `0000` applied is missing conversation pinning and
last-seen, and those features return 500 rather than degrading.

| Migration | Adds |
|---|---|
| `0000_baseline_existing_schema` | Everything |
| `0001_pin_conversations` | Conversation pinning |
| `0002_user_last_seen` | `users.last_seen_at` |

`prisma migrate deploy` is safe to re-run; it applies only what is outstanding. Never run
`prisma migrate dev` against a deployed database — it can reset it.

## CI

`.github/workflows/ci.yml` runs on `main`, `develop` and `dev2` and on PRs: install, build shared,
`prisma generate`, type-check both apps, run both test suites, build both apps.

`.github/workflows/deploy-staging.yml` runs the same sequence on a push to `staging`, then calls
the Render deploy hook only if everything passed.

**One asymmetry to know about:** Vercel builds from the same push independently and is **not** gated
on those tests. A commit that fails CI can still reach the web app. If that matters for production,
disable Vercel's git integration and trigger it from the workflow instead.

## Sizing and tier notes

- **Render free instances sleep after inactivity.** The first request after a quiet period takes
  around 30 seconds. Acceptable for staging; for production either move to a paid instance or accept
  that the first user each morning waits. A keep-alive ping against `/health` is the usual
  workaround.
- **Supabase's pooler is required.** `DATABASE_URL` must be the `:6543` pooled string. The direct
  `:5432` connection is for migrations only and will exhaust connections if used at runtime.
- **Sockets are stateful and in-process.** Rooms live in the Node process's memory, so **the API
  cannot be scaled beyond one instance** without adding the Socket.IO Redis adapter. Two instances
  today means two users connected to different ones never see each other's messages. Redis is
  already provisioned, so this is a small change — but it has not been made, and horizontal scaling
  will silently half-break realtime until it is.
- **Storage is unbounded.** Nothing prunes old attachments. Watch the Supabase storage quota.

## Rollback

The API rolls back through Render's dashboard — previous images are retained and redeploying one is
immediate. Vercel likewise promotes a previous deployment.

**Migrations do not roll back.** `0001` and `0002` are both additive (a new column, a new table), so
an older API image runs fine against the newer schema. Keep that property: a migration that drops or
renames a column makes rollback impossible without a restore.

## Operational reference

| Symptom | Cause |
|---|---|
| Everything loads, nothing sends | Once gap 1 is fixed: `CORS_ORIGIN` does not match the web origin. Scheme and host, no trailing slash. |
| App calls `localhost:4000` in production | `NEXT_PUBLIC_API_URL` was set after the build. Redeploy the web app. |
| Messages need a refresh to appear | The socket is not connecting. Same cause as above, or the API is asleep. |
| Images and avatars 400 | Buckets are private (correct) but the request is not signed — check `SUPABASE_SERVICE_KEY` and `STORAGE_ENDPOINT`. |
| First request after idle hangs ~30 s | Render free tier sleeping. Expected. |
| `prisma migrate deploy` fails on a self-signed certificate | The `sslrootcert` path is relative to `apps/api`; run from that directory. |
| API will not start, logs a missing variable | `DATABASE_URL`, `REDIS_URL` or `JWT_SECRET`. The log names it. |
| API will not start, complains about a certificate | `apps/api/certs/supabase-prod-ca-2021.crt` is missing from the image. Fail-closed by design. |
| Build fails on `@messenger/shared` | `packages/shared` was not built first, or Vercel's Root Directory is not the repository root. |
| `npm ci` fails on peer dependencies | Missing `--legacy-peer-deps`. |
| Nobody can sign in to a new environment | The seed was never run. Step 4. |
