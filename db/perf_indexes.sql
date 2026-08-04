-- Performance indexes — run once against the live DB
-- Safe to re-run: all use CREATE INDEX IF NOT EXISTS

-- Speed up unread-count LATERAL (filters by sender_id and deleted_at)
CREATE INDEX IF NOT EXISTS idx_messages_sender_id
    ON messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_messages_deleted_at
    ON messages(deleted_at)
    WHERE deleted_at IS NULL;

-- Speed up listConversations ORDER BY
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON conversations(updated_at DESC);

-- Speed up membership lookups (conversation_id leading, for LATERAL subqueries)
CREATE INDEX IF NOT EXISTS idx_conversation_members_conv_user
    ON conversation_members(conversation_id, user_id);

-- Speed up last-message LATERAL (conversation_id + created_at DESC)
-- Already covered by idx_messages_conversation_id_created_at but make DESC explicit
CREATE INDEX IF NOT EXISTS idx_messages_conv_created_desc
    ON messages(conversation_id, created_at DESC);
