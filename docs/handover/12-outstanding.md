# 12 — Outstanding work

Everything known to be unfinished, unfixed or worth deciding about, in one place.

**As of `00859e2`, 2026-08-12.** Every figure below was measured on that commit, not recalled — the
commands to re-measure are at the bottom, and they matter more than the numbers, because this
document is only true until the next change.

---

## Nothing is failing

| Suite | Result |
|---|---|
| API unit | **284 / 284** |
| Web unit | **197 / 197** |
| Security, live against the running API | **65 / 65** |
| File, input and exception handling, live | **54 / 54** |
| API and web typecheck | clean |
| `next build` | clean |

Everything below is unfixed **by decision**, not by failure. No test covers any of it — which is
the point of writing it down.

---

## Known bugs

From the reliability audit ([the six patterns](#where-these-came-from)). Audited and reported, not
fixed. **None of these appear in the gaps register**, so this is the only record of them.

### A3 — No idempotency key · **P0**

Sending has no client-generated id. `socket.timeout(12_000)` cannot tell *"the server never got
it"* from *"the server saved it and the reply was lost"* — it assumes the first and retries.

**Consequence:** a lost acknowledgement puts a **second message in the database**, permanently. It
cannot be cleaned up afterwards, because two identical messages a second apart are indistinguishable
from someone genuinely sending twice. Delete is admin-only, so the person who sent it cannot remove
their own duplicate.

**Likelihood:** ordinary. Anyone on mobile, patchy wifi, or a sleeping laptop.

**Fix:** `client_message_id UUID` on `messages`, unique on `(sender_id, client_message_id)`,
generated in the composer and carried through `OutboxItem`; `sendMessage` returns the existing row
instead of inserting.

**Retrofitting is only partly possible.** Messages written before the column exists have no key, so
past duplicates can never be identified — only future ones are prevented.

### A4 — Denormalized client state · **P0**

`handleMessageDeleted` and `handleMessageEdited` update `messages[]` only
([MessageThread.tsx:319-325](../../apps/web/src/components/MessageThread.tsx#L319)). The same
message is also held in `pinnedMessages`, `bookmarks`, `searchResults` and
`conversations[].last_message`.

**Consequence:** delete a pinned message and **its text stays readable in the pinned bar**. Deletion
is admin-only — it exists to remove something that should not be there — so the feature reports
success while the content is still on screen in two other places. Edits drift the same way.

**Likelihood: 100%.** Not a race. Pin a message, delete it, and it happens every time.

**Fix:** a `Record<string, Message>` entity map, with the other lists holding ids only. No state
library needed.

### A1 + A2 — No ordering tiebreaker, and a pagination gap · **P0, latent**

`id` is `uuid_generate_v4()` — random, not sortable — and `orderBy: { created_at: 'desc' }` has no
second key, so the order is not *total*. Postgres may return tied rows either way, and on two runs
of the same query may answer differently. The pagination cursor is the same non-unique column with
strict `lt`.

**Consequence:** two clients can render the same two messages in opposite orders, permanently. Worse,
a tied message at a page boundary is `lt`-excluded and **never fetched** — an invisible hole in
scrollback with no error and no placeholder.

**Likelihood: low today, and rising.** Every message is its own transaction, so a tie needs two
independent commits inside the same microsecond. But `created_at` defaults to `now()`, which is
`transaction_timestamp()` — **identical for every row in one transaction** — so any future batch
(an import, a backfill, a multi-forward optimised into one transaction) makes ties certain. Running
more than one API instance also makes concurrent commits normal rather than incidental.

**Fix:** `orderBy: [{ created_at: 'desc' }, { id: 'desc' }]`, the same comparator on the client, and
extend `idx_messages_conv_created_desc` to `(conversation_id, created_at DESC, id DESC)`. Then the
cursor becomes `(created_at, id)`. **Not a ULID migration** — `id` is a `uuid` with foreign keys
from five tables.

**The argument for doing it now is cost, not risk.** Three lines today. After a batch insert has
written 10,000 tied rows, the correct order no longer exists to recover.

### A6 — Typing does a database read per keystroke · **P2**

`typing:start` writes nothing, but calls `isMember()` — one query — and the client emits on **every
keystroke**, unthrottled; only the *stop* is debounced at 2 s.

**Consequence:** ~5 queries per second per active typist. Nothing at 55 accounts. It matters when
concurrent typists approach the pooler's connection budget — which is during a busy channel, exactly
when you want the API responsive.

**Fix:** throttle the client emit to once per 2 s, or cache membership on `socket.data` at connect.

---

## Open gaps

Ten of twenty-one are closed (G1–G6, G18–G21). Eleven remain — full detail in
[06-gaps.md](06-gaps.md).

### Needs you, not code

| | What | Why it can't wait indefinitely |
|---|---|---|
| **G16** | Vercel Root Directory is `frontend`; must become the repository root | The production build **breaks the moment `dev2` merges into `main`**. Change it *before*, not after. |
| **G13** | 15 accounts store `"Manager"`; the code compares against `"manager"` | Harmless until the first `@Roles('manager')` exists — then those 15 silently lose every manager permission, with no error. |
| **G17** | `git remote set-url origin https://github.com/hairicle/message-app.git` | Pushes work but warn; the old URL will stop resolving eventually. |

`G13` is one statement, and worth checking the count before and after:

```sql
SELECT role, count(*) FROM users GROUP BY role;
UPDATE users SET role = lower(role) WHERE role <> lower(role);
```

### Unbuilt features

- **G7** — bulk user import is a stub that returns **HTTP 201** with `created: 0`. The success status
  on a total failure is the trap; do not wire anything to it.
- **G8** — link previews are rendered by the client and generated by nothing. The field is always
  `null`, so the renderer is dead code.
- **G9** — Teams and Announce are built and gated behind `COMING_SOON`. **Never QA'd.** Turning
  either on is one deletion, so someone should exercise them first.
- **G10** — tasks and meetings are API-only, no UI, no client module.
- **G11** — no push to a closed tab. In-browser notifications do work while it is open.
- **G12** — mobile apps. The web app is responsive and works in a phone browser.

### Housekeeping

- **G14** — 51 files still carry 400 px previews from before the preview fix. The client works
  around it by preferring the original under 600 KB; larger old images stay soft. A backfill would
  fix them and does not exist.
- **G15** — `README.md` and `.env.example` describe the pre-monorepo system: `backend/`, `frontend/`,
  Express, Vite, local Postgres, MinIO. They are the first two files a new joiner opens.

---

## Live data, measured on this commit

```
role "staff"     39
role "Manager"   15      ← G13
role "admin"      1

messages         194 total, 102 stored UNENCRYPTED
files            54 with previews
```

⚠️ **`MESSAGE_ENCRYPTION_KEY` is not set**, so message bodies are being written as plaintext and
every new message joins the 102. This was left deliberately — writing rows under a key nobody chose
would be worse — but it means encryption is currently doing nothing here.

Two separate steps, in this order:

1. Set `MESSAGE_ENCRYPTION_KEY` (a different one for each environment; **losing it makes those
   messages unrecoverable**, so back it up wherever `JWT_SECRET` is).
2. `npm run encrypt:messages --workspace=apps/api -- --apply` to convert what is already stored.
   Encryption applies to new messages only; until this runs, a database dump still hands over the
   whole history.

---

## Recorded, deliberately not fixed

Absence is harder to notice than a number, so these are written down rather than left implicit.

- **A zero-byte file is accepted** and stored, HTTP 201. Arguably correct — an empty file is a real
  thing to send.
- **18 routes have no UI in front of them** — teams, tasks, meetings, calls. Reachable by any
  authenticated user. Worth blocking at the edge until those features ship.
- **`message_deliveries`** is a table with a Prisma model that nothing references. A future
  developer will assume it is load-bearing.
- **No storage quota**, per user or in total, and nothing prunes old attachments.
- **Search is truncated at 4,000 rows.** It is fast *because* it is truncated, and will silently
  stop finding older matches in a long conversation. A correctness limit, not a performance one.
- **Login is capped at 10 attempts per 15 minutes** per address-and-account. Eight wrong passwords
  and that person waits. Defensible, cannot affect a colleague, and one edit if it proves harsh.

---

## If you only do two things

**A3** and **A4.**

A3 is the only open item that puts **wrong data in the database** rather than displaying right data
badly — and the information needed to identify duplicates can only be captured going forward.

A4 is deterministic, visible, and makes a moderation action appear to have worked when it did not.

Everything else is either latent (A1/A2), a decision (the unbuilt features), or someone else's
console (G16, G17).

---

## How to re-check this document

The G1 entry in the gaps register described a live camera bug for longer than it was live, because
nobody re-ran the check. Assume the same of this page. Every number above comes from one of these:

```bash
# Tests
npm test                                              # both unit suites
npm run test:security --workspace=apps/api            # live, needs the API running
npm run test:files    --workspace=apps/api            # live
npm run test:perf     --workspace=apps/api            # live

# Open gaps
grep -nE "^### (~~)?G[0-9]+\." docs/handover/06-gaps.md
```

The live data figures come from three queries against the database:

```sql
SELECT role, count(*) FROM users GROUP BY role;
SELECT count(*) FILTER (WHERE octet_length(ciphertext) > 0 AND get_byte(ciphertext, 0) <> 1)
       AS unencrypted, count(*) AS total FROM messages;
SELECT count(*) FROM files WHERE has_thumbnail;
```

## Where these came from

- The five **A-numbered bugs**: an audit against six reliability patterns — sortable ids, keyset
  pagination, idempotency, normalized client state, last-read pointers, ephemeral presence. The
  sixth pattern (last-read) was already correct and needs nothing.
- The **G-numbered gaps**: [06-gaps.md](06-gaps.md), compiled by reading the code rather than a
  backlog.
- The **test figures**: [07](07-security-test.md), [08](08-file-and-input-test.md),
  [09](09-performance-test.md).
