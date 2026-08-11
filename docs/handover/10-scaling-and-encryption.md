# 10 — Running more than one instance, and encryption at rest

Two changes that alter how the system is deployed, and one that alters what a database dump is
worth. Both were gaps [G4](06-gaps.md) and [G5](06-gaps.md); this is the detail behind them, plus
the CI change that came with them ([G18](06-gaps.md)).

---

# The API can now run more than one instance

## What was wrong

Socket.IO rooms live in the memory of the process that created them. On one instance that is
invisible. On two, **everything looks correct**: both are healthy, both accept connections,
messages are written and read — while two people who happened to land on different instances never
see each other's messages. Nothing errors, nothing is logged, no health check fails.

That silence is why it was worth fixing before anyone scaled the service rather than after: the
symptom is a user saying "he isn't getting my messages", which is indistinguishable from a hundred
other things.

## What changed

`RedisIoAdapter` ([`realtime/redis-io.adapter.ts`](../../apps/api/src/realtime/redis-io.adapter.ts))
puts every room broadcast onto Redis pub/sub, so an instance relays to its own sockets and publishes
for the rest.

It needs **two** connections — a Redis client in subscribe mode may not issue ordinary commands, so
the subscriber cannot be the one the block list and presence use. Both come from
`RedisService.duplicate()` and inherit the same retry strategy and error handling as the main one; a
pub/sub connection that threw on a network blip would have taken the process down exactly as the
main one used to.

**It degrades rather than fails.** With Redis unreachable the server still runs and still delivers
within its own process — correct on a single instance, no worse than before on several — and picks
up the others when Redis returns.

## Verified

Two instances started on different ports, a client connected to each:

```
PASS  clients connect to different instances
PASS  a message sent on instance 1 reaches a client on instance 2
PASS  and the other direction
PASS  typing indicators cross instances too
```

## What this means for the deploy

Horizontal scaling and autoscaling are now safe. Nothing else needs configuring — the adapter uses
the `REDIS_URL` already set.

One thing that has **not** changed: Render must still route a socket's whole session to one
instance, which it does by default. And presence remains a Redis fact, so it was already correct
across instances.

---

# Message bodies are encrypted at rest

## Why this is not end-to-end

Say this plainly to anyone who asks, because the column has been called `ciphertext` since the
beginning and it held base64 — an encoding, not a cipher.

**The key lives on the server.** The running API can read every message, and so can anyone holding
both the database and the key. What this removes is the far more likely exposure: a database dump, a
backup, a leaked connection string, or the hosting provider's own staff reading the `messages`
table. That is a real and worthwhile boundary, and it is not the one "end-to-end" describes.

End-to-end is a different project, and the reason is not the cryptography. It is that the server
currently reads message text for three things, and none of them can survive only the participants
holding the key:

- **Search** matches bodies.
- **The conversation list** shows the last message under each row.
- **Notifications** put the text in the preview.

Each needs an answer — client-side search indexes, a stored preview the sender encrypts separately,
notifications that say only who sent something — before key exchange, per-device keys and
verification are even reached. The `signal_*` tables in the schema are where that work would go.

## How it works

```
[0x01][12-byte IV][16-byte auth tag][ciphertext…]
```

AES-256-GCM, so a row altered underneath us **fails to decrypt rather than decrypting to something
else**. A fresh random IV per message, because GCM repeats catastrophically if an IV is reused under
one key.

**The leading version byte is what made this deployable on a live database.** Rows written earlier
hold base64, whose first byte is always a printable ASCII character and therefore never `0x01`, so
old and new are told apart with certainty rather than a guess. Both read correctly, which meant no
downtime and no migration ordering to get right.

Two deliberate details:

- **An empty body stays empty.** A deleted message is blanked to zero bytes; encrypting nothing into
  29 bytes of envelope would make deleted rows look like they still held something.
- **Decryption never throws.** A body that cannot be read returns empty, putting one unreadable
  bubble on screen where an exception would fail the whole page it appeared on and take the rest of
  the conversation with it.

## What had to change around it

Two raw SQL queries — the conversation list's last-message preview and `listUndelivered` — used
`convert_from(ciphertext, 'UTF8')`. An encrypted envelope is not valid UTF-8, and `convert_from`
fails the **whole query**, not the one row. Both now `encode(…, 'base64')` and decrypt in Node,
where the key is.

Search survived only because it already matched in Node over a bounded scan rather than in SQL. A
`LIKE` in the query would have stopped working outright — worth remembering before anyone
"optimises" search by pushing it down into the database.

## Verified

```
the stored body carries the version marker    first byte 0x01
the plaintext is not in the stored bytes      57 bytes: 018e0fd10d0f15a17cadb792a60e9e4b…
but it reads back correctly through the API   "across two instances"
the conversation list preview decrypts        yes
search still finds it                          1 result
```

## What the deploy needs

**`MESSAGE_ENCRYPTION_KEY` is now a required production variable.** 32 bytes as 64 hex characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Without it the API still starts and still works — and stores plaintext, warning at startup. It is
not fail-closed because refusing to boot would take down an existing deployment on upgrade; the
warning is the signal.

**Treat it like the database password.** Lose it and every message encrypted under it is
unrecoverable — there is no recovery path, by design. Back it up wherever `JWT_SECRET` is backed up.
It must differ between staging and production.

### Converting the existing messages

Encryption applies to messages sent from now on. The ones already stored keep opening exactly as
before, but they are not protected — a dump still hands over the whole history until they are
converted:

```bash
npm run encrypt:messages --workspace=apps/api            # report what would change
npm run encrypt:messages --workspace=apps/api -- --apply # do it
```

Safe to re-run; already-encrypted rows are skipped, so an interrupted run is resumed by starting it
again. One transaction per batch of 500, so an interruption leaves whole batches done and never a
half-written row.

---

# Vercel deploys are gated on CI

Vercel built from its own Git integration on the same push that triggered this workflow, which made
the web app the one thing that shipped **without the tests having passed**. A commit that failed CI
still reached users.

`deploy-staging.yml` now has a `deploy-web` job that needs `verify`, builds with the Vercel CLI and
deploys the prebuilt output. Building in CI also means what ships is the exact tree the tests ran
against, rather than a second build of the same commit.

**This only holds while Vercel's own Git integration is off.** In the project: Settings → Git →
Ignored Build Step set to `exit 0`, or disconnect the repository. With both enabled every push
deploys twice and the ungated one can win — which is worse than before, because it looks gated.

Three repository secrets are needed:

| Secret | Where to find it |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link`, or Team Settings |
| `VERCEL_PROJECT_ID` | the same file, or Project Settings |

The job checks all three first and fails naming whichever is missing, rather than deploying nothing
quietly.
