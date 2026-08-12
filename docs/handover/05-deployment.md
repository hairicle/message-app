# 5 — Production deployment

Staging is already running and its build-out is documented step by step in
[../staging-deploy.md](../staging-deploy.md). **Read that first** — production follows the same
sequence with the same constraints. This document covers what production adds: the full variable
reference, what must not be shared with staging, the blockers on `main`, and the gaps to close
before going live.

## Known gaps — read before going live

The three below are the ones that change how you configure the deploy. The **complete** register is
[06-gaps.md](06-gaps.md). None of these are hypothetical; each was confirmed by reading the code.

> **Five earlier gaps are now closed** and re-verified live: CORS no longer accepts every origin,
> rate limiting is enforced, message bodies are encrypted at rest, the API can run more than one
> instance, and Vercel deploys are gated on the tests. See [07](07-security-test.md) and
> [10](10-scaling-and-encryption.md).
>
> **Three things change for you.** `CORS_ORIGIN` and `MESSAGE_ENCRYPTION_KEY` are now read, and
> both belong in the variable table below — a deployment that omitted the first will now find the
> web app cannot reach the API. And Vercel's own Git integration has to be turned off, or the
> gating this adds is undone by a second, ungated build of the same commit.

### 1. `CORS_ORIGIN` must be set, and must match exactly

Set it to the web app's origin — scheme and host, **no trailing slash**, no path. Several origins
may be given, comma-separated, which is how you allow a preview deployment alongside production.

Unset, the API allows only `localhost:3100` and `localhost:3000` and logs a warning naming the
variable. It does not fall back to allowing everything.

**Outside production** (`NODE_ENV` is anything but `production`) any loopback or private-network
address is also accepted — `localhost`, `127.0.0.1`, `::1`, `10.x`, `192.168.x`, `172.16–31.x`.
That is not laxity, it is a fix: `localhost:3100` and `127.0.0.1:3100` are the same server and
different origins, and opening the app at the wrong spelling made every request fail. In production
the rule is off, because there the deployment has a real hostname and a private-address origin is
never a legitimate caller.

### 2. `MESSAGE_ENCRYPTION_KEY` must be set, and must be kept

Message bodies are encrypted at rest. Without the variable the API still starts and still works —
and stores plaintext, warning at startup.

**Lose the key and every message encrypted under it is unrecoverable.** There is no recovery path,
by design. Back it up wherever `JWT_SECRET` is backed up, and never share it between staging and
production.

After the first deploy, convert the messages already stored — encryption applies to new ones only,
and until this is run a database dump still hands over the whole history:

```bash
npm run encrypt:messages --workspace=apps/api -- --apply
```

**This is encryption at rest, not end-to-end.** The key is on the server. Do not let anyone sign off
believing otherwise — [10-scaling-and-encryption.md](10-scaling-and-encryption.md#why-this-is-not-end-to-end)
explains the difference and what end-to-end would still cost.

### 3. Several variables no longer exist

`FRONTEND_URL`, `MAX_FILE_SIZE_MB`, `UPLOADS_DIR` and every `LDAP_*` / `FIREBASE_*` setting were
declared in config and read by nothing. They have been removed rather than documented — setting
them in Render does nothing, and they can be deleted from the dashboard.

The upload limit is `MAX_FILE_SIZE` in `modules/files/file-rules.ts`; change the code, not a
variable.

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
| `CORS_ORIGIN` | `https://messenger.example.com` | The web app's origin, no trailing slash. Comma-separate several. **Unset, the deployed web app cannot reach the API.** |
| `MESSAGE_ENCRYPTION_KEY` | 64 hex characters | Encrypts message bodies at rest. **Unset, bodies are stored as plaintext** and the API warns at startup. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Lose it and every message encrypted under it is unrecoverable** — back it up with `JWT_SECRET`, and never share it between staging and production. |

### API — optional

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Render assigns this |
| `NODE_ENV` | — | Set to `production` |
| `JWT_EXPIRES_IN` | `1h` | Staging uses `8h` |
| `TOTP_ISSUER` | `InternalMessenger` | Name shown in authenticator apps |

### API — set but inert

None. The variables that used to be listed here were removed from the code rather than left to be
explained; if any are still set in Render they can be deleted.

### Web (Vercel)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | The public API origin, e.g. `https://messenger-api.onrender.com`. **Inlined at build time** — changing it requires a redeploy, not a restart. |

### GitHub Actions

| Secret | Notes |
|---|---|
| `RENDER_DEPLOY_HOOK_API` | A deploy hook scoped to the one service. Render's own auto-deploy is off so this workflow is the only thing that ships. |
| `VERCEL_TOKEN` | Account Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link`, or Team Settings |
| `VERCEL_PROJECT_ID` | the same file, or Project Settings |

The web app is deployed **from the workflow**, after the tests. Vercel's own Git integration must be
turned off for the project — Settings → Git → Ignored Build Step set to `exit 0` — or every push
deploys twice and the ungated build can win. See [10-scaling-and-encryption.md](10-scaling-and-encryption.md).

## The ordering constraint

The two deploys depend on each other and cannot be done in parallel:

```
   Vercel build  ──needs──▶  the API's URL      (NEXT_PUBLIC_API_URL, baked in at BUILD time)
   Render API    ──needs──▶  the web's origin   (CORS_ORIGIN, read at RUNTIME)
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
| Everything loads, nothing sends | `CORS_ORIGIN` does not match the web origin. Scheme and host, no trailing slash, no path. |
| Messages appear blank after a key change | `MESSAGE_ENCRYPTION_KEY` differs from the one they were written under. There is no recovery; restore the original key. |
| Two users cannot see each other's messages, no errors anywhere | Historically: two instances without shared rooms. Fixed — but check Redis is reachable, since the adapter falls back to per-process delivery. |
| Sign-in refused with 429 after a few tries | The login limit: 10 attempts per 15 minutes for that address and account. It clears itself; `Retry-After` says when. |
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
