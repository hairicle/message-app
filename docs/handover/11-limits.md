# 11 — Limits

Every bound the system enforces, what happens when you cross it, and where the number lives.

Compiled by probing the running API rather than by reading constants, which is how three of these
turned out not to exist.

---

## Files

| What | Limit | Crossing it |
|---|---|---|
| Attachment | **50 MB** | `413 That file is too large`, and the client refuses it before uploading |
| Profile or group picture | **5 MB** | `413`, same |
| Image preview generated | 1280 px longest edge, JPEG q82 | — |
| Decodable image size | ~268 megapixels | Stored without a preview rather than refused |

The limit is applied to the **stream**, not after it: multer aborts as soon as it is passed, so a
400 MB upload moves peak memory by 87 MB rather than 400. The numbers live in
[`file-rules.ts`](../../apps/api/src/modules/files/file-rules.ts), mirrored for the client's
early check in [`uploadLimits.ts`](../../apps/web/src/utils/uploadLimits.ts).

**Not limited:** total storage per user or overall. Nothing prunes old attachments and no quota is
enforced — watch the Supabase storage figure.

## Message text

| What | Limit | Crossing it |
|---|---|---|
| What a person may type | **8,000 characters** | Send is disabled, and a counter appears for the last tenth |
| Stored body, the server's backstop | **64 KB encoded** | `400`, naming the field |
| Whole request body | 100 KB (Express) | `413 That request is too large` |

There was no limit at all, and the two transports failed differently and badly:

```
before   HTTP    past ~90 KB  → 500  (a caller's long message, logged as our fault)
         socket  500 KB       → accepted
         socket  past ~900 KB → silently dropped: no acknowledgement, no error, no message

after    HTTP    past 64 KB   → 400 "ciphertext: That message is too long"
                 past 100 KB  → 413 "That request is too large"
         socket  past 64 KB   → refused: "ciphertext: That message is too long", socket stays up
```

The silent drop was the worst of the three. The message stayed on screen looking sent, so it read
as a slow network rather than as nothing happening.

The client counts **characters as a person sees them**, not UTF-16 units — an emoji is one, not two,
so a counter does not fall twice as fast as the text someone pasted.

## Passwords

| What | Limit | Crossing it |
|---|---|---|
| Minimum | 8 characters | `400` |
| Maximum | **72 bytes** | `400`, saying why |

The maximum is not a choice this application made — **bcrypt ignores everything past 72 bytes.**
Accepting more told people their long passphrase was stronger than it was, and a live check
confirmed it: an account set with a 102-character password opened with the first 72 of them.

Bytes, not characters, because bytes are what bcrypt truncates: one emoji is four of them.

Applied wherever a password is set, including the administrator's create-user form — an account
someone else creates should not get a password its owner could never set again.

## Text fields

| Field | Limit |
|---|---|
| Display name | 100 characters |
| Username | 50 |
| Group name | 120 |
| Group description | 500 |
| Reaction emoji | 32 characters |
| Search query | 200 characters |

The reaction cap is not cosmetic: `emoji` is part of that table's composite primary key, so an
oversized value exceeds Postgres's index row limit and the insert fails — a 10,000-character
"emoji" used to answer 500.

## Collections

| What | Limit |
|---|---|
| Messages per page | 1–100, default 50 |
| Members named when creating a group or adding to one | 500 per request |
| Minimum group size | 3, counting you |
| Rows a search reads | 4,000 most recent |
| Results a search returns | 50 |

**The search scan limit is a correctness limit, not a performance one.** Matching happens in Node,
so a search is quick *because* it is truncated — and it will silently stop finding older matches in
a long conversation. Worth remembering before anyone calls search fast.

## Requests

| What | Limit | Crossing it |
|---|---|---|
| Any signed-in request | **300 per minute**, counted per token | `429` with `Retry-After` |
| Sign-in | **10 per 15 minutes**, per address **and** account | `429`, self-clearing |
| Two-factor step | 5 per 15 minutes | `429` |
| `GET /health` | exempt | — |

Counting a login against the account as well as the address is what makes the tight budget safe
here: everyone in an office shares one address, so per-address counting alone would have given the
whole company ten sign-ins a quarter hour. Being guessed at cannot lock out a colleague, and the
cool-off clears itself — no administrator has to undo it.

**Note for capacity:** 300/min is per *token*, not per person, so someone signed in on a phone and a
laptop has two budgets.

---

# Not limited

Recorded because absence is harder to notice than a number.

- **Storage.** No quota per user or in total; nothing prunes.
- **Conversations per user**, and **members per conversation** as a standing total — only the 500
  named in a single request is bounded.
- **Message edits.** No cap on how many times, or how long after sending.
- **Attachments per message.** One file per message by design, but nothing limits how many messages.
- **Socket connections per account.** A client opening hundreds is not refused.
- **Reactions per message**, beyond one per person per emoji.
