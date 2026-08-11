# 9 — Performance and speed

Third in the set, after [07](07-security-test.md) and [08](08-file-and-input-test.md). Those ask
whether the system is correct; this one asks whether it is quick enough, and where the time goes.

```bash
npm run test:perf --workspace=apps/api
```

Harness: [`apps/api/scripts/performance-test.mjs`](../../apps/api/scripts/performance-test.mjs).
Seeds up to 20,000 messages, measures, and deletes everything in `finally`.

## Read the numbers with this in mind

They were taken on a developer machine in Cambodia talking to a Supabase instance in Singapore.
**One database round trip costs 32 ms from here.** In production the API and the database are in the
same region, where that is 1–3 ms.

So the absolute figures below are not production figures. What *does* travel is the **shape**: which
operations stay flat as data grows, and how many round trips each one spends. Those are properties
of the code, and they are the same wherever it runs.

Percentiles rather than averages throughout — one slow request in twenty is what people notice.

---

# Results

## The thing most worth knowing: reading a thread is flat

```
GET 50 messages from a thread of    100    p50 136ms    21 KB
GET 50 messages from a thread of  1,000    p50 136ms    21 KB
GET 50 messages from a thread of  5,000    p50 135ms    21 KB
GET 50 messages from a thread of 20,000    p50 133ms    21 KB
```

A two-hundred-fold increase in the thread costs nothing. The keyset pagination and its index are
carrying the query — the page is found, not scanned for. Scrolling up (`before=<id>`) is 172 ms,
one extra round trip for the cursor lookup, and equally flat.

This is the property that decides whether the app is still usable in two years, and it holds.

## Baselines

```
GET /health                     p50   1ms     no auth, no database
GET /api/auth/me                p50  35ms     ≈ 1 round trip
GET /api/users/directory        p50  37ms     ≈ 1 round trip
GET /api/conversations          p50  35ms     ≈ 1 round trip
```

Against a 32 ms floor, each of these is a single round trip with no measurable overhead of its own.
Auth, the guards and the account-status cache add ~3 ms combined — the in-process cache in front of
the Redis block list is doing its job, or every one of these would carry an Upstash round trip too.

## Sign-in

```
POST /api/auth/login            p50 324ms
```

Almost all of it is bcrypt at cost 12, which is deliberate — that is the cost of making a stolen
password database expensive to attack. Not a fault, and not something to tune down.

## Search

```
in one conversation of 20,000   p50  69ms
across every conversation       p50 100ms   (p95 295ms)
```

Faster than reading a page, which is counter-intuitive until you know why: matching happens in Node
rather than SQL, over a scan capped at 4,000 rows. It is quick **because it is truncated**. That
also means it will not get slower with more data — and that it will silently stop finding older
matches. A correctness limit, not a speed one, and worth remembering before anyone calls search
"fast".

## The conversation list

```
5 conversations    p50 46ms
25 conversations   p50 46ms
```

Flat. The list is one query regardless of size.

## Sending, and how quickly it lands

```
POST /api/messages                     p50 173ms   (p95 429ms)
socket send → other client receives    p50 166ms
```

166 ms end-to-end between two clients is comfortably inside the ~200 ms where a chat still feels
live — and most of it is the write, not the socket. In production, with the database in the same
region, this should fall well under 50 ms.

## Under concurrency

```
  5 requests,  1 at a time     541ms total   108ms each
 50 requests, 10 at a time     612ms total    12ms each
150 requests, 30 at a time    1502ms total    10ms each
```

**Throughput improves ten-fold as concurrency rises**, which is what a healthy connection pool looks
like: the 32 ms round trip is latency, not occupancy, so requests overlap instead of queueing. No
5xx at any level, and the new rate limiter did not fire — 150 requests is well inside the 300/min
budget.

## Attachments

```
1x1 png (no preview work)      p50 378ms
3000x2000 photo, 35 KB         p50 405ms   (p95 1172ms)
```

Generating the 1280px preview and pushing two objects to storage adds ~30 ms over a trivial upload.
The work is dominated by the two round trips to Supabase Storage, not by sharp.

---

# The one structural observation

A page of messages costs **~4.2 round trips**; sending one costs **~5.4**. Everything else costs 1.

That is not a mystery, and it is not a defect. `listMessages` runs a membership check, then a
`findMany` that loads three relations — `files`, the original sender, and `message_reactions` with
its own nested `users`. **Prisma issues a separate query per relation**, so a single logical read is
several sequential trips to the database.

**In production this is a small number of milliseconds and not worth touching.** It matters in two
narrower situations: on a cold Render instance whose first request is already slow, and if the
database is ever moved further from the API.

If it does become worth attacking, in order of return:

1. **Run the membership check alongside the main query rather than before it.** It is a full round
   trip spent proving something before doing anything. `Promise.all` both, then throw if the check
   failed — nothing is returned to a non-member either way, and the 403 is preserved. Folding the
   check into the query's `where` clause would be faster still, but it turns a 403 into an empty
   list, which is a contract change and one the security suite asserts against.
2. **Reduce the relations loaded per message.** `users_messages_original_sender_idTousers` exists to
   label forwards, which are rare; fetching it for every message in every page pays for the
   exception on behalf of the rule.
3. `relationLoadStrategy: "join"` would collapse the relation queries into one statement, but it is
   not available in the generated client for this Prisma version and driver-adapter combination.
   Checked, not assumed.

None of this is recommended now. It is written down so that whoever sees a slow thread load one day
starts from a measurement rather than a guess.

---

# Not measured

- **Production latency.** Everything here is cross-region; the real figures need a run from inside
  the deployment.
- **Cold start.** Render's free instances sleep, and the first request after that takes ~30 s. That
  is platform behaviour, unaffected by anything in this report.
- **The web client.** No bundle size, render, or scroll-performance measurement.
- **Sustained load.** The concurrency test is a burst, not a soak — nothing here would reveal a leak.
- **Socket fan-out.** Delivery was measured between two clients. A group of fifty on one message is
  a different question, and one worth asking before Teams ships.
- **Anything above 300 requests a minute**, which the rate limiter now refuses by design.
