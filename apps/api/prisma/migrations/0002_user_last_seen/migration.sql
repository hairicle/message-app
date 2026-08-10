-- When someone was last connected, so an offline colleague can say how long ago rather than only
-- that they are not here now.
--
-- On users rather than in Redis, where presence itself lives: presence is a fact about right now
-- and can be rebuilt from who is connected, but last-seen is a fact about the past and would be
-- lost the first time the cache was cleared.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
