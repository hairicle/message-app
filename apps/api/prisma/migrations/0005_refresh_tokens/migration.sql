-- A session that outlives an access token, so signing in is not a daily chore.
--
-- There was no refresh flow at all: the access token expired after an hour and the person signed in
-- again. On the web that is an annoyance. On a phone it is fatal, and it fails at the worst moment —
-- a notification arrives, the person taps it, and lands on a login screen instead of the message.
--
-- Raising the access token's lifetime is not the same thing. An access token is a signature and
-- cannot be withdrawn before it expires, which is precisely why the disabled-account block list
-- exists; a thirty-day one would sit in a stolen phone for a month. A refresh token is a row, so
-- deleting it ends the session on the next attempt.
--
-- Per device, because that is the unit people think in — "sign out my old phone" — and because the
-- device row already exists and already carries a name.

-- The SHA-256 of the token, never the token. A database dump then contains nothing that can be
-- presented as a session; the value is high-entropy random, so a plain digest is sufficient and
-- bcrypt would only make every refresh slow.
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT;

-- When the session stops being valid regardless of use, so an abandoned device cannot be revived
-- months later.
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;

-- Lookup is by hash: the client presents a token, not a device id, and it must not be trusted to
-- say which device it belongs to. Unique so a hash identifies at most one session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_refresh_token_hash
  ON user_devices (refresh_token_hash);
