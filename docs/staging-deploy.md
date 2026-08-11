# Staging deployment

| Part | Platform | Source |
|---|---|---|
| API (`apps/api`) | Render | `apps/api/Dockerfile` |
| Web (`apps/web`) | Vercel | `vercel.json` |
| Database + storage | Supabase | separate project from production |
| Redis | Upstash | separate database from production |

---

## The ordering constraint

The two deploys depend on each other, so they cannot be set up in parallel:

```
   Vercel build  ──needs──▶  the API's URL      (NEXT_PUBLIC_API_URL, baked in at BUILD time)
   Render API    ──needs──▶  the web's origin   (CORS_ORIGIN, read at RUNTIME)
```

Because Vercel's dependency is a *build* input and Render's is only a *runtime* one, the way
through is:

1. Deploy the API first and take note of its URL.
2. Build the web app against that URL.
3. Go back and tell the API which origin to allow, then restart it.

Doing it in the other order produces a web bundle that calls `localhost:4000`, and no amount of
changing environment variables afterwards fixes it — only a rebuild does.

---

## Step 1 — Create the staging Supabase project

A separate project from production. Sharing one means test accounts, test messages and any
destructive experiment land in real data.

1. Create the project, region **Southeast Asia (Singapore)** to sit near the API.
2. **Storage → create two buckets**: `messenger-files` and `avatars`.
3. Set **both buckets to private.** New projects create buckets public by default, and public
   buckets hand out permanent unauthenticated links to every attachment and avatar — the exact
   exposure the signed-URL work removed.
4. Collect from **Settings → Database** and **Settings → API**:
   - pooled connection string (`:6543`, ends `?pgbouncer=true`)
   - direct connection string (`:5432`)
   - service role key
   - project ref, for the storage endpoint

## Step 2 — Create the staging Redis

An Upstash database, also Singapore. Copy its `rediss://…` URL. This holds the session block list,
so staging must not share production's.

## Step 3 — Apply the schema

The new database is empty. From your machine:

```bash
cd apps/api
DIRECT_URL="postgresql://…:5432/postgres?sslmode=verify-full&sslrootcert=./certs/supabase-prod-ca-2021.crt" \
  npx prisma migrate deploy
```

Keep the `sslmode=verify-full&sslrootcert=…` suffix — it is what makes the connection verify
Supabase's certificate instead of trusting anything.

Check the URL before running. Nothing here distinguishes staging from production for you.

## Step 4 — Create the first admin

A fresh database has no accounts, so nothing can sign in yet.

```bash
cd apps/api
SEED_ADMIN_EMAIL=you@company.com npm run seed:admin
```

It prints a generated password once — sign in and change it. Pass `SEED_ADMIN_PASSWORD` instead if
you would rather choose one, and `SEED_ADMIN_USERNAME` / `SEED_ADMIN_NAME` to set those.

Re-running it never overwrites an existing account, so it is safe if you are unsure whether it has
already been done.

## Step 5 — Deploy the API on Render

**New → Web Service**, connect this repository.

| Setting | Value |
|---|---|
| Branch | `staging` |
| Runtime | Docker |
| Dockerfile path | `apps/api/Dockerfile` |
| Docker context | `.` (repository root) |
| Health check path | `/health` |
| Region | Singapore |
| Auto-deploy | **Off** — the workflow decides when to ship |

Environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | pooled Supabase string from step 1 |
| `DIRECT_URL` | direct string **with** the `sslmode=verify-full&sslrootcert=…` suffix |
| `SUPABASE_SERVICE_KEY` | service role key |
| `STORAGE_ENDPOINT` | `https://<project-ref>.supabase.co/storage/v1/s3` |
| `STORAGE_BUCKET` | `messenger-files` |
| `AVATAR_BUCKET` | `avatars` |
| `STORAGE_REGION` | `ap-southeast-1` |
| `REDIS_URL` | Upstash URL from step 2 |
| `JWT_SECRET` | a fresh 64-char random hex — never production's |
| `JWT_EXPIRES_IN` | `8h` |
| `NODE_ENV` | `production` |

Leave `CORS_ORIGIN` and `FRONTEND_URL` unset for now — the Vercel URL does not exist yet. Note that
`CORS_ORIGIN` is read as of the security fixes, so the API will refuse the web app until step 7
sets it. Until then it allows only localhost and says so in its startup log.

Deploy, then **note the service URL**, e.g. `https://messenger-api-staging.onrender.com`.
Check `<url>/health` responds before continuing.

`render.yaml` in the repository root describes this same service if you would rather apply it as a
Blueprint.

## Step 6 — Deploy the web app on Vercel

In the `message-app` project (or a new one for staging):

| Setting | Value |
|---|---|
| Root Directory | **repository root** — not `frontend` |
| Build | supplied by `vercel.json` |
| `NEXT_PUBLIC_API_URL` | the Render URL from step 5 |

Root Directory matters: `apps/web` depends on the `@messenger/shared` workspace, which resolves to
`dist/` and has to be compiled first. `vercel.json` runs

```
npm ci --legacy-peer-deps
npm run build --workspace=packages/shared && npm run build --workspace=apps/web
```

which `next build` on its own does not do.

Push the `staging` branch and let Vercel build. **Note the resulting URL**, e.g.
`https://message-app-git-staging-<scope>.vercel.app`.

## Step 7 — Close the loop

Back in Render, set both to the Vercel URL from step 6:

- `CORS_ORIGIN`
- `FRONTEND_URL`

Restart the service. Until this is done the browser reaches the API and is refused by CORS, which
usually shows up as every request failing while the API's own logs look healthy.

## Step 8 — Wire the deploy hook

Render service → **Settings → Deploy Hook**. Add the URL to
**GitHub → Settings → Secrets and variables → Actions** as `RENDER_DEPLOY_HOOK_API`.

From then on:

```bash
git checkout staging
git merge --ff-only develop
git push origin staging
```

`.github/workflows/deploy-staging.yml` type-checks both apps, runs all 134 tests, builds both, and
only then triggers the Render deploy. Vercel builds from the same push independently.

---

## Verifying it works

1. Open the Vercel URL and sign in with the admin from step 4.
2. Send a message — exercises the API, the database and the socket.
3. Send an image — exercises Supabase storage and signed URLs.
4. Open the same account in a second tab and send from one — if the message appears in the other
   without a reload, the WebSocket connected.

Step 4 is the one that catches a misconfigured `NEXT_PUBLIC_API_URL`: HTTP requests may still work
through a proxy, but the socket connects directly to the API and fails loudly when the URL is
wrong.

---

## Things that commonly go wrong

**Everything loads but nothing sends.** `CORS_ORIGIN` does not match the Vercel origin. It must be
the scheme and host with no trailing slash.

**The app calls `localhost:4000` in production.** `NEXT_PUBLIC_API_URL` was set after the build.
Next inlines `NEXT_PUBLIC_*` at build time — redeploy the web app to pick it up.

**Messages need a refresh to appear.** The socket is not connecting. Same cause as above, or the
API is asleep.

**Images and avatars 400.** The buckets are private (correct) but the request is not signed — check
`SUPABASE_SERVICE_KEY` and `STORAGE_ENDPOINT`.

**The first request after a quiet period hangs for ~30s.** Render's free instances sleep when idle.
Expected for staging.

**`prisma migrate deploy` fails on a self-signed certificate.** The `sslrootcert` path is relative
to `apps/api`; run the command from that directory.

---

## Before this pattern reaches production

Vercel's production deployment currently builds `main` with Root Directory `frontend`, which the
monorepo removes. **That build breaks the moment the monorepo lands on `main`** unless Root
Directory is moved to the repository root and `NEXT_PUBLIC_API_URL` is set, exactly as in step 6.
Doing staging first is the safe way to prove those settings before production depends on them.
