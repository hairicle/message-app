# 8 — File handling, validation and exception test

Companion to [07-security-test.md](07-security-test.md). That one asks whether the walls hold; this
one asks what happens when a caller sends something malformed, hostile or merely strange — and
whether the answer is a clear 4xx or a 500 logged as our fault.

**Latest run: 54 of 54 passed.** The first run found eight failures; seven were real and are fixed,
one was a bug in the test.

| Run | Result |
|---|---|
| First | 42 of 50 |
| After the input fixes | 50 of 50 |
| After the file-handling fixes | **54 of 54** |

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

# Observations — both since fixed

Both of these were recorded as decisions rather than bugs, and both were then taken.

## O1 — The upload size limit protected storage, not memory — **FIXED**

`FileInterceptor` was mounted with no `limits`, so multer buffered the entire request body in
memory before either size check ran. A caller could make the API allocate as much as they cared to
send, and the 50 MB limit only stopped it reaching storage — a denial-of-service vector on a
free-tier instance with a few hundred megabytes of RAM.

The limit now lives on multer as well as on the validator, so the stream is cut off the moment it
is passed. It is applied to attachments (50 MB) and to both avatar routes (5 MB).

**Measuring it needed a better instrument than the first attempt used.** Elapsed time still grows
with the payload, because the *client* goes on sending after the server has stopped storing — so
timing was the wrong signal, and reading it as "still buffering" would have been wrong. Sampling the
API process during a 400 MB upload is the right one:

```
baseline RSS                     144.6 MB
peak RSS during a 400 MB upload  232.0 MB   (+87.5 MB)
response                         413 "File too large"
```

400 MB sent, **87 MB held** — the limit plus overhead, not the payload.

One more thing had to change with it. multer reports a limit breach by throwing a `MulterError`,
which is not an `HttpException`, so it would have become a **500** — telling the caller their
too-large file was our fault. The exception filter now maps it to **413 Payload Too Large**, and the
other multer refusals to 400 with a sentence each.

The web app also checks the size before uploading now. The server is still what enforces it; the
client check is the difference between being told straight away and watching a progress bar cross a
200 MB file before the answer arrives.

## O2 — Nothing validated the declared content type — **FIXED**

The API stored whatever MIME type the client claimed. An SVG carrying a script and an HTML file
declaring `text/html` were both accepted and stored as declared.

They were inert on download — but because Supabase served the SVG as an attachment and the HTML as
`text/plain`, which is the storage provider's behaviour and not a property of this system. Change
provider, or a bucket setting, and that moves without anything here failing.

**Nothing is rejected.** This is a messenger: people send spreadsheets, archives and installers, and
an allowlist would be wrong about a colleague's work file every week. What is removed is a file's
ability to *run*. A declared type a browser would execute or render as a document is stored as
`application/octet-stream` — the file still downloads under its own name, and can never render
itself, whoever is serving it.

| Uploaded as | Stored as |
|---|---|
| `image/svg+xml`, `text/html`, `application/xhtml+xml` | `application/octet-stream` |
| `text/xml`, `application/xml`, `application/xslt+xml` | `application/octet-stream` |
| `application/javascript`, `text/javascript`, `text/vbscript` | `application/octet-stream` |
| nothing at all | `application/octet-stream` |
| `image/png`, `application/pdf`, `.xlsx`, `video/mp4`, `text/plain` | unchanged |

Parameters are stripped before comparing, so `text/html; charset=utf-8` is caught. The check is
applied *before* the preview branch, which has a second benefit: sharp is never asked to rasterise
an SVG, and so never parses an XML document that may reference something outside itself.

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
