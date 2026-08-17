# 12 — Outstanding work

Everything known to be unfinished, unfixed or worth deciding about, in one place.

**As of the current `dev2`, 2026-08-12.** Every figure below was measured on that commit, not recalled — the
commands to re-measure are at the bottom, and they matter more than the numbers, because this
document is only true until the next change.

---

## Nothing is failing

| Suite | Result |
|---|---|
| API unit | **313 / 313** |
| Web unit | **221 / 221** |
| Security, live against the running API | **65 / 65** |
| File, input and exception handling, live | **54 / 54** |
| API and web typecheck | clean |
| `next build` | clean |

Everything below is unfixed **by decision**, not by failure. No test covers any of it — which is
the point of writing it down.

---

## Known bugs

From the reliability audit ([the six patterns](#where-these-came-from)). **None of these appear in
the gaps register**, so this is the only record of them. Two of the four are now fixed.

### ~~A3 — No idempotency key~~ — **FIXED** in `7d4cfc2`

The sender attaches a `clientMessageId`, generated once when the message is written and reused by
every retry; the server returns the message it already stored. Verified live on both transports,
including eight simultaneous sends of one id producing a single row. The unique index decides the
concurrent case, and the loser reads back what the winner wrote.

Done as Phase 0.2 of [the Android plan](13-android-app.md), where it stopped being optional — on a
phone a lost acknowledgement is the ordinary condition rather than a hiccup.

**Messages written before `7d4cfc2` carry no id**, so any duplicates already in the table cannot be
identified. Only future ones are prevented, which is why this was worth doing before the mobile
client rather than after.

### ~~A4 — Denormalized client state~~ — **FIXED**

The thread was not the only place a message body lived on screen. The pinned bar, the bookmarks
list, the search results and the sidebar's one-line preview each keep their own copy — necessarily,
because a pinned message may be thousands of messages up and never loaded into the thread, so they
cannot hold an id and look it up.

The socket handlers updated the thread and nothing else, so **deleting a pinned message left its
text readable in the pinned bar** while the deletion reported success. Deletion is
administrators-only; it exists to remove something that should not be there.

Every list is now corrected through one pair of pure helpers, `applyEdit` and `applyDeletion`, so
the rule is written once rather than remembered in two handlers. Blanked rather than removed,
because that is what the server does — `deleteMessage` writes an empty body and leaves the row, and
neither the pin nor the bookmark query filters deleted messages out, so dropping the entry would
look tidier and disagree with the next refetch. Verified live: after a delete, a refetch returns
empty text in all three places, which is exactly what the client now shows without one.

The sidebar preview needed one server change to be fixable at all — it carried no message id, so
the client could not tell whether a deletion referred to it. `last_message.id` is now returned and
has no other use.

### ~~A1 + A2 — No ordering tiebreaker, and a pagination gap~~ — **FIXED**

One fix, because they were one cause. `created_at` is not unique — it defaults to `now()`, which is
the *transaction* timestamp and identical for every row written in one transaction — so ordering by
it alone was not a total order, and the keyset cursor built on it was not exact.

Messages now order by `(created_at, id)` on the server, on the client, and in the index; the cursor
is the same pair.

**The pagination half was the destructive one, and it is worth seeing the size of it.** Ten messages
sharing one timestamp, after a first page of three:

```
old cursor   created_at < cutoff                    →  0 more rows reachable
new cursor   (created_at, id) < (cutoff, anchor)    →  7 more rows reachable
```

The remaining seven were unreachable by any page — no error, nothing missing on screen to notice.
Verified at scale too: 120 messages sharing a single timestamp now page through completely, no
duplicates, and two independent reads return byte-identical order.

**One residual, stated because it is real.** The column is microsecond-precision, but Prisma returns
a JavaScript `Date` and JSON serialises milliseconds — so the client never sees microseconds. For
rows written in one transaction that costs nothing, because their timestamps are identical to the
microsecond and the server is tie-breaking on the id too. Two separate transactions inside one
millisecond could be ordered by microsecond on the server and by id on the client, and a reload
corrects it, since a page renders in the order the server returned rather than being re-sorted.

Reading a page is still flat as the thread grows — 188 ms at 100 messages, 198 ms at 20,000 — so
the wider index is not costing anything.

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

## What to do next
**Phase 0 is complete.** Sessions, idempotency, ordering and push are all done, and the Android app
can begin — see [13-android-app.md](13-android-app.md), Phase 1.

Push is unverified against a real device by necessity: it needs Firebase credentials and a phone.
Set  and the first send is the test.

Only **A6** — the typing throttle, a P2 — remains from the audit.

After it, **Phase 0.1 — refresh tokens**, which is the remaining blocker for the Android client and
the largest single piece left. Everything else is either latent (A1/A2), a decision (the unbuilt
features), or someone else's console (G13, G16, G17).

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
