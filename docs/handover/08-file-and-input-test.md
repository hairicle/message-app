# 8 — File handling, validation and exception test

Companion to [07-security-test.md](07-security-test.md). That one asks whether the walls hold; this
one asks what happens when a caller sends something malformed, hostile or merely strange — and
whether the answer is a clear 4xx or a 500 logged as our fault.

**Latest run: 50 of 50 passed.** The first run found eight failures; seven were real and are fixed,
one was a bug in the test.

| Run | Result |
|---|---|
| First | 42 of 50 |
| After the fixes | **50 of 50** |

```bash
npm run test:files --workspace=apps/api
```

Harness: [`apps/api/scripts/file-handling-test.mjs`](../../apps/api/scripts/file-handling-test.mjs).
Creates its own accounts, deletes everything in `finally`, and reports what it failed to clean up.

## Coverage

| Section | Checks | What it probes |
|---|---|---|
| A — Upload shape and size | 6 | missing file, wrong field, empty file, the 50 MB boundary |
| B — Filename handling | 9 | traversal, Windows paths, dotfiles, 300 characters, markup, unicode |
| C — Content type | 6 | SVG and HTML payloads, bytes contradicting the declared type |
| D — Image processing | 6 | corrupt images, a 225-megapixel image, a gigapixel header, aspect ratio, EXIF |
| E — Avatar uploads | 4 | the 5 MB limit, non-images, direct conversations |
| F — Input verification | 17 | query strings and bodies across the message and conversation routes |
| G — Exception shape | 5 | error body consistency, leakage, unknown routes, malformed JSON |

---

# Findings — all fixed

## V1 — Seven endpoints answered 500 for a malformed request

Same class as [S3](07-security-test.md#s3--unhandled-type-errors-return-500--fixed), found in seven
more places. Each was a caller's mistake being recorded as a server fault.

| Request | Before | Now |
|---|---|---|
| `GET /api/messages?limit=abc` | 500 | **400** |
| `GET /api/messages` with no `conversationId` | 500 | **400** |
| `GET /api/messages/search` with no `q` | 500 | **400** |
| `POST /api/messages/:id/reactions` with a 10,000-character emoji | 500 | **400** |
| `POST /api/messages/:id/reactions` with no `emoji` field | 500 | **400** |
| `POST /api/conversations` with `type: "telepathy"` | 500 | **400** |
| `POST /api/messages` replying to a message that does not exist | 500 | **400** |

Two of these are worth more than a row in a table.

**The reaction emoji.** The column is part of the reactions table's composite primary key, so an
oversized value does not merely store badly — it exceeds Postgres's index row limit and the insert
fails. Now capped at 32 characters, which is generous for something that is a handful of code
points, and applied to the delete path as well as the insert.

**The page size.** `limit` was passed through as `Number(limit)`, so `abc` became `NaN` and any
number at all was accepted. It is now an integer between 1 and 100. Unbounded, it was a request to
read an entire conversation into memory and serialise it.

## V2 — A message could name an attachment that does not exist, and succeed

`POST /api/messages` with a `fileId` that matches nothing returned **201**. The message was created
first and the attachment linked afterwards with an `updateMany` whose `where` matched no rows —
which updates nothing and reports no error. The result was an image bubble with no image in it,
rendering as "attachment unavailable" forever.

The attachment is now checked **before** the message row is written, and a `fileId` that does not
exist, belongs to someone else, or is already attached to another message is a 400.

## V3 — The socket transport bypassed every schema

This is the one that would have made the rest of the work cosmetic.

The gateway's `message:send` handler calls `MessagesService.sendMessage` directly, so validation
placed on the HTTP controller left the socket unguarded — and the socket is the transport most
sends actually use. The schema now lives **in the service**, where both transports pass through it.

Verified live over a real socket: a malformed reply is refused with a legible acknowledgement and
**the socket stays connected** rather than dropping the client.

```
emit message:send  { replyToMessageId: <nonexistent> }
  → { ok: false, error: "The message being replied to is not in this conversation" }
  → socket still connected
```

Two things came with that schema, both deliberate: `system` is not an accepted message type — the
server writes those to narrate events like someone joining, and a client able to post one could
forge that narration — and `replyToMessageId`/`fileId` accept `null` as well as an absent key,
because "no reply" is an absence a client may reasonably spell either way.

Replies are also checked against the conversation, not just for existence. Quoting a message from a
thread you are in, into one you are not, would have surfaced its text in the reply preview.

## A bug in the test, not the code

`G2` checked that no stack trace leaks, with a pattern including `at \w+`. It reported a failure on
the body `{"error":"That identifier is not valid"}` — because "th**at** identifier" matches. The
pattern now looks for an actual stack frame (`at name (file:line)`) or a file reference. Recorded
because a test that cries wolf is worse than no test.

---

# What passed first time

**Filenames are never trusted.** Every stored object is named `<uuid><ext>`, so the original name
is metadata and nothing more. Confirmed against `../../../etc/passwd`,
`C:\Windows\System32\evil.png`, `.htaccess`, a 300-character name, `x.<script>alert(1)</script>`,
`фото-📸-café.png` and `...` — every resulting storage key was a flat single name with no separator
and no traversal segment.

**Image processing fails softly.** A corrupt image, bytes that contradict the declared type, and a
missing content type are all stored without a preview rather than raising. A hand-built PNG header
claiming 40000×40000 — 1.6 gigapixels in 69 bytes, the classic decompression bomb — is refused by
the decoder's pixel ceiling in 148 ms rather than obeyed. A real 225-megapixel image is processed in
about three seconds.

**Preview geometry is right.** An extreme aspect ratio survives (4000×100 → 1280×32), an image
smaller than the preview size is not enlarged (40×40 stays 40×40), and EXIF orientation is applied,
so a portrait phone photo previews upright.

**Avatars** enforce their own 5 MB limit, tolerate a non-image, and are refused outright on a direct
conversation, whose picture is the other person's.

**Exceptions are consistent.** Every error body is `{ error: string }`. No stack trace, file path,
SQL or Prisma internals appear in any response. An unknown route is a clean 404, malformed JSON is a
400, and a method a route does not implement is a 404.

---

# Observations — judgement calls, not defects

These are recorded rather than fixed, because each is a decision rather than a bug.

## O1 — The upload size limit protects storage, not memory

`FileInterceptor` is mounted with no `limits`, so multer buffers the entire request body in memory
before either size check runs. Measured:

```
55 MB  → refused in 229 ms
150 MB → refused in 768 ms
```

The time scales with the payload, which means the whole thing was read before it was rejected. A
caller can therefore make the API allocate as much memory as they care to send, and the 50 MB limit
only stops it reaching storage.

**The fix is one line** — `FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } })` —
which makes multer abort mid-stream. It is not applied here because it changes the error a caller
sees for an oversized upload, and the web client's message for that case would want to change with
it. Worth doing before production; it is a denial-of-service vector on a free-tier instance with a
few hundred megabytes of RAM.

## O2 — Nothing validates the declared content type

The API stores whatever MIME type the client claims, with no allowlist. An SVG carrying a script and
an HTML file declaring `text/html` are both accepted and stored.

**They are inert on download, but not because of anything this code does.** Supabase decides:

```
the SVG   → content-type: image/svg+xml, content-disposition: attachment   (downloaded, not rendered)
the HTML  → content-type: text/plain, no disposition                        (displayed as source)
```

Both are safe today, and both would still be on a different origin from the app even if they were
not. But the safety is the storage provider's behaviour, not a property of this system — change
provider, or change a bucket setting, and it moves without anything here failing. If that matters,
an allowlist on upload is the thing that would not move.

## O3 — A zero-byte file is accepted

`201`, stored, attachable to a message. Harmless, and arguably correct — an empty file is a real
thing a person may want to send. Noted because it is the sort of thing that surprises whoever finds
a 0 KB attachment in a conversation.

---

# Not covered

- **The web client.** Nothing here tests how an attachment renders, or the client-side compression.
- **Voice notes** beyond the generic file path — no duration extraction or waveform test.
- **Storage exhaustion.** Nothing prunes old attachments and no quota is enforced.
- **Concurrent uploads** of the same file, or upload cancellation part-way.
