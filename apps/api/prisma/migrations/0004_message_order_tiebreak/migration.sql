-- A total order for a conversation's messages.
--
-- `created_at` alone is not unique. It defaults to now(), which is the *transaction* timestamp and
-- therefore identical for every row written in one transaction, so ties are certain the first time
-- anything inserts in bulk — an import, a backfill, a multi-forward. Two independent commits inside
-- the same microsecond tie as well, which running more than one API instance makes ordinary.
--
-- Ordering by a non-unique key leaves the tie to the planner, so two runs of the same query may
-- disagree. Adding the id makes the order total, and lets keyset pagination use the pair as an
-- exact cursor: under the old one, `created_at < cutoff` excluded the boundary message's twin and
-- no page ever returned it.
--
-- Matching the query's ORDER BY exactly — both keys descending — is what lets the index be read
-- straight through instead of sorted afterwards.
CREATE INDEX IF NOT EXISTS idx_messages_conv_created_id_desc
  ON messages (conversation_id, created_at DESC, id DESC);

-- Superseded: every query that used it now wants the id as well, and a two-column prefix of the
-- index above answers anything this one did.
DROP INDEX IF EXISTS idx_messages_conv_created_desc;
