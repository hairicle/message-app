-- Whether this person wants their phone to buzz.
--
-- A separate column rather than reusing desktop_enabled, which controls the browser notification
-- shown while a tab is open. Someone who silenced that has said they do not want a box appearing
-- over their work; they have not said anything about the phone in their pocket, and reading one
-- preference as the other would silence a channel they never chose to silence.
--
-- Defaults on, because a messaging app that never notifies is a worse surprise than one that does,
-- and the app asks for permission before a notification can arrive anyway.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;

-- Finding who to notify starts from "every device with a token", so the token is what the query
-- filters on. Partial, because most rows have none — every browser session creates a device row and
-- only a phone ever registers a token, so indexing the nulls would be indexing almost everything.
CREATE INDEX IF NOT EXISTS idx_user_devices_push_token_present
  ON user_devices (user_id)
  WHERE push_token IS NOT NULL;
