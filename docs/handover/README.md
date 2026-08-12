# Deployment handover

Written for the DevOps team taking this system to production. Everything here was read off the
code on `dev2` at commit `8395080`, not from an earlier design document — where the code and the
older docs disagree, the code wins and the difference is called out.

| # | Document | Read it when |
|---|---|---|
| 1 | [Overview](01-overview.md) | You need to know what this is, what it's built from, and what's actually shipped |
| 2 | [Project structure](02-structure.md) | You need to know what builds from where, and in what order |
| 3 | [How it works](03-flow.md) | You need to know what talks to what, so you know what to provision and what breaks when it's missing |
| 4 | [API reference](04-api-reference.md) | You're writing smoke tests, a gateway config, or a WAF rule |
| 5 | [Production deployment](05-deployment.md) | You're doing the deploy |
| 6 | [Gaps register](06-gaps.md) | **Read before sign-off.** Everything missing, stubbed, dead or broken, with what is now closed |
| 7 | [Security test results](07-security-test.md) | A live penetration test of the API — 65/65 after fixes, with every finding and what it did and did not mean. Re-runnable. |
| 8 | [File, validation and exception test](08-file-and-input-test.md) | What happens on malformed, hostile or merely strange input — 54/54 after fixes. Re-runnable. |
| 9 | [Performance and speed](09-performance-test.md) | Where the time goes. Reading a thread is flat from 100 to 20,000 messages; throughput improves ten-fold under concurrency. Re-runnable. |
| 10 | [Scaling and encryption](10-scaling-and-encryption.md) | The API can now run more than one instance, message bodies are encrypted at rest, and Vercel deploys are gated on CI. **Two new required variables.** |
| 11 | [Limits](11-limits.md) | Every bound the system enforces — files, message length, passwords, rate limits — what happens when you cross it, and what is not limited at all. |
| 12 | [Outstanding work](12-outstanding.md) | **Start here for "what is left".** Every known bug, open gap and decision still to make, with how to re-measure each figure. |

Staging is already running and documented separately in
[../staging-deploy.md](../staging-deploy.md). Production follows the same shape; document 5 covers
what differs and what must not be shared between the two.

## Read this before you start

Three things in the repository are misleading, and each has cost time already:

- **The root `README.md` is stale.** It describes a pre-monorepo layout (`backend/`, `frontend/`),
  Express, and Vite. None of that is true any more — the API is NestJS and the web app is Next.js,
  both under `apps/`. Trust these documents over it.
- **`.env.example` is stale in the same way.** It describes a self-hosted Docker Compose stack with
  MinIO and local Postgres. The deployed system uses Supabase and Upstash. The authoritative
  variable list is in [05-deployment.md](05-deployment.md#environment-variables).
- **Two environment variables are documented but not read by the code.** `FRONTEND_URL` and
  `MAX_FILE_SIZE_MB` have no effect. (`CORS_ORIGIN` was a third until the security fixes; it is now
  read, and **required in production** — see [05-deployment.md](05-deployment.md).)
