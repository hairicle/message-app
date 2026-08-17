# 13 — Android app plan

A plan, not a specification. It says what to build, in what order, and — more usefully — **what has
to change in the API before any of it works**.

## Decisions taken

| | |
|---|---|
| **Approach** | React Native + Expo |
| **First release** | Chat only, with push notifications |
| **Distribution** | Internal — direct APK or MDM, no Play Store |
| **iOS** | Probably later, so keep that door open |

React Native follows from the last row and from what already exists. The API client, the socket
layer and the `@messenger/shared` types are TypeScript; Kotlin would rewrite all three and rewrite
them again for iOS. Expo additionally supplies the two things this project needs most — push
delivery through FCM, and over-the-air updates, which matter unusually much when there is no store
to push a new build through.

---

# What already helps

Worth stating, because it means the app is not starting from nothing:

- **Auth is a bearer token.** No cookies, no CSRF, no session affinity. A mobile client authenticates
  exactly as the web one does.
- **Realtime is Socket.IO**, and `socket.io-client` runs on React Native unchanged. Not Supabase
  Realtime — that distinction matters when reading anything that assumes otherwise.
- **`packages/shared`** is types-only, so the app can consume the same 24 exported types the web app
  does and stay honest about the API's shape.
- **`user_devices.push_token`** already exists as a nullable column, and `getOrCreateDevice` already
  creates a row per device at login and returns its `deviceId`. Half the push plumbing is in place.
- **Files come back as a 302 to a signed URL**, which React Native's `fetch` and `Image` both follow.
- **The API can run more than one instance** and **rooms are shared through Redis**, so a phone
  reconnecting to a different instance is already correct.

---

# Phase 0 — Server work that must come first

**None of this is app code, and the app cannot ship without it.** Roughly a week.

## ~~0.1 — Sessions have to outlive an hour~~ · **DONE**

There was no refresh flow: the access token expired after an hour and the person signed in again.
Fatal on a phone, and worst at the moment a notification is tapped.

A refresh token now comes back with every sign-in — thirty days, per device, **rotated on every
use**, and stored as a SHA-256 digest so a database dump contains nothing presentable as a session.
`POST /api/auth/refresh` exchanges it; `POST /api/auth/logout` ends it. Neither is behind the auth
guard, because both have to work once the access token has already expired.

Refusals are deliberately identical — an invented token, a spent one, an expired one and one
belonging to a disabled account all answer "Session expired, please sign in again", so the endpoint
cannot be used to test which tokens are real. A disabled account is refused **and** has its session
row cleared rather than left to retry.

Verified against a server issuing three-second access tokens: a request after expiry succeeds
transparently with exactly one renewal, and **five concurrent requests expiring together share one
renewal** rather than each exchanging a token the others had just rotated away — the failure a
naive client would hit on every page load.

The web client does this too, so it also stops asking people to sign in daily.

**One thing worth revisiting:** the refresh token is in `localStorage` beside the access token. An
httpOnly cookie would be out of reach of scripts, but the API has no cookie session at all, so
that is a change to both ends rather than a line in the client. Recorded rather than pretended.

## ~~0.2 — Idempotency stops being optional~~ · **DONE**

A lost acknowledgement made the retry create a second message. On the web that needs a network
hiccup; on mobile it is the normal condition, so the app would have shipped duplicates as routine.

The sender attaches a `clientMessageId`, generated once when the message is written and reused by
every retry; the server returns the message it already stored. Verified on both transports, and
eight simultaneous sends of one id produce a single row — the unique index decides that race and
the loser reads back what the winner wrote.

**The app must generate one per message and reuse it on every attempt.** A fresh id per attempt
would be a fresh message per attempt, which is the bug restated.

## 0.3 — Push notifications

The one feature that justifies an app at all — otherwise this is a phone browser with an icon.

**Server side:**

1. `POST /api/users/me/push-token` — writes `user_devices.push_token` for the device the token was
   issued to, and clears it on sign-out.
2. Send on new message, from the same `messages.events` emitter the gateway already subscribes to —
   so HTTP and socket sends both notify, without a second code path. That emitter exists precisely
   because a previous attempt at a second path delivered to nobody.
3. **Respect what already exists**: `conversation_members.muted_until`, and the member's own
   `last_read_message_id` so a message already read on the laptop does not buzz the phone.
4. Add `push_enabled` to `notification_preferences`. Do not reuse `desktop_enabled` — someone who
   silenced browser notifications has not asked to silence their phone.

`firebase-admin` was uninstalled in `b58e1ae` because nothing used it. It comes back here, when it
does.

**Payload:** send the sender's name and conversation id, and — deliberately — **not the message
text**, or at least make that a preference. Message bodies are encrypted at rest specifically so the
server's storage does not hand them over; putting the plaintext through Google's push service and
onto a lock screen undoes a good part of that.

## 0.4 — Worth doing at the same time

- ~~**A1 / A2, the ordering tiebreaker.**~~ **Done.** Messages order by `(created_at, id)` on both
  ends and the keyset cursor uses the pair — which also closed a hole where messages sharing a
  timestamp were unreachable by any page. Offline sync would have made ties common, since a flushed
  outbox writes several messages in quick succession.
- **A6, the typing throttle.** Still open. Every keystroke is a socket emit; on a mobile radio that
  is battery.

---

# Phase 1 — The app, signed in and reading · ~2 weeks

Expo project in **`Messager Android/`**, a separate folder beside this repository rather than inside
it.

That was decided deliberately, against the recommendation further down this document: one tree is
simpler to work in, and it costs the guarantee that the client's types cannot drift from the API's.
That folder's README lists the three ways to keep them honest and what each trades — **pick one
before writing the API client, not after.**

- Expo Router, TypeScript.
- **Token storage in `expo-secure-store`**, never `AsyncStorage` — the latter is plain text on disk.
- Login, including the TOTP second step, which the web already implements and the API already
  supports.
- Conversation list, with unread counts from the same `/api/conversations` payload.
- Message thread: read, paginate, render text and images.
- The API client is a thin port of `apps/web/src/lib/api/` — same endpoints, same shapes.

**Done when:** someone can sign in and read every conversation they have on the web.

---

# Phase 2 — Sending, realtime and offline · ~2 weeks

- Socket.IO connection with the bearer token in the handshake, exactly as the web does.
- Send text and images; camera and gallery via `expo-image-picker`.
- **The outbox has to be real here.** The web version keeps it in memory and loses it on reload; on
  mobile the OS suspends the app routinely, so it needs persisting to disk and flushing on
  reconnect. This is where 0.2 pays for itself.
- **Foreground/background handling.** Android will kill a socket in the background — do not fight
  it. Socket while foregrounded, push while not, and reconcile on resume by fetching anything
  missed. `GET /api/messages/undelivered` already exists for exactly this.
- Read receipts, using the existing `last_read_message_id` pointer.

**Done when:** two people can hold a conversation across web and phone without either missing
anything.

---

# Phase 3 — Push, end to end · ~1 week

- `expo-notifications` registration, permission prompt, token upload to 0.3's endpoint.
- Tapping a notification opens that conversation — which needs the refresh token from 0.1 to work,
  or it opens a login screen.
- Badge counts, notification grouping per conversation, and honouring mute.

**Done when:** the phone is locked, someone sends a message, and tapping the notification lands on
it.

---

# Phase 4 — Shipping it · ~1 week

- EAS Build producing a signed APK.
- **`expo-updates` configured.** With no store, this is how a fix reaches people without asking them
  to re-install — any JavaScript-only change ships over the air. Native changes still need a new
  APK, so the split matters.
- Distribution through MDM if there is one, otherwise a download link behind the existing login.
- A **minimum-version check**: the API returns the lowest client version it will serve, and older
  builds show "update required" rather than failing strangely. Cheap now, impossible to retrofit
  once old builds are in the wild.
- Crash reporting — Sentry, or Expo's own.

---

# Roughly six to seven weeks

For one developer, including the server work. Phase 0 is the part most likely to be underestimated,
because none of it is visible in the app.

That estimate assumes chat only. It does not include reactions, replies, forwarding, pinning,
bookmarks, voice notes, search, group management or the admin dashboard — all of which the web app
has and none of which are in this scope.

---

# Things worth deciding before starting, not during

**~~Where the app lives.~~ Decided: a separate folder,** `Messager Android/`, beside this
repository rather than `apps/mobile` inside it.

This document originally recommended the opposite, and the reasoning still stands as a cost rather
than an argument to reopen: inside the workspace the app imports `@messenger/shared` directly, so
the client's types cannot drift from the API's. Outside it, they are two independent opinions that
happen to agree, and something has to keep them honest deliberately. The three ways of doing that
are in that folder's README. **Choose one before writing the API client.**

**What a notification says.** See 0.3. This is a privacy decision, not a technical one, and it is
easier to start conservative and loosen it than the reverse.

**Whether the API needs versioning.** Once an APK is installed, you no longer control which client
is talking to you — someone will run last month's build for a year. Either version the API, or keep
every change backward-compatible and enforce a minimum version. **Recommendation: minimum version
check**, which is far less work and sufficient for an internal tool.

**Offline reading depth.** Caching the last N messages per conversation for offline reading is a
different feature from an outbox, and considerably more work. Suggest leaving it out of v1 and
seeing whether anyone asks.

---

# What I would not do

- **Do not start the app before Phase 0.** A mobile client on one-hour sessions and no idempotency
  will produce bug reports about duplicate messages and constant logouts, and both will look like
  app bugs while being server ones.
- **Do not wrap the web app** as a stopgap "while the real app is built". It will be good enough to
  stop the real one, and not good enough to be liked.
- **Do not put the message text in the push payload** without deciding that deliberately.
- **Do not build offline caching in v1.** It is the largest source of scope creep in mobile chat
  apps, and it is invisible until it is wrong.
