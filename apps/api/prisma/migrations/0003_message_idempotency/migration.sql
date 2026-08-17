-- An id the sender chooses, so a retry is recognised instead of duplicated.
--
-- Sending has always been at-least-once and nothing made it idempotent. The client waits twelve
-- seconds for an acknowledgement and cannot tell "the server never received it" from "the server
-- saved it and the reply was lost" — so it assumes the first and sends again. On a desktop that
-- needs a network hiccup; on a phone it is the ordinary condition, and the Android client would
-- have made duplicate messages routine.
--
-- Nullable, because every message written before this has no such id and none can be invented for
-- them. Rows from before the column exists are simply not protected, which is why this is worth
-- adding before the mobile client rather than after.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id UUID;

-- The uniqueness is per sender, not global: two people may generate the same id and neither should
-- be able to suppress the other's message.
--
-- No WHERE clause is needed to exempt the existing rows. Postgres treats NULLs as distinct in a
-- unique index, so every row without a client id coexists happily; only two rows carrying the same
-- id from the same sender collide, which is exactly the case being prevented.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_id
  ON messages (sender_id, client_message_id);
