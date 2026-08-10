-- Pinning a conversation is per member, like muting: it is how one person orders their own list,
-- not a property of the conversation that everyone in it would share.
--
-- Nullable rather than a boolean plus a timestamp: the moment it was pinned is what orders the
-- pinned rows against each other, and NULL says "not pinned" without a second column that could
-- disagree with the first.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
