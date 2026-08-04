import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DatabaseService) {}

  async assertMember(conversationId: string, userId: string) {
    const r = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Not a member of this conversation');
  }

  async listConversations(userId: string) {
    const r = await this.db.query(
      `SELECT c.*,
         (cm.muted_until IS NOT NULL AND cm.muted_until > now()) AS is_muted,
         COALESCE(unread.count, 0)::int AS unread_count,
         lm.msg AS last_message,
         mem.members AS members
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS count
         FROM messages m
         LEFT JOIN messages lrm ON lrm.id = cm.last_read_message_id
         WHERE m.conversation_id = c.id
           AND m.sender_id != $1
           AND m.deleted_at IS NULL
           AND (cm.last_read_message_id IS NULL OR m.created_at > lrm.created_at)
       ) unread ON true
       LEFT JOIN LATERAL (
         SELECT row_to_json(sub) AS msg FROM (
           SELECT u.username AS sender_username, u.display_name AS sender_display_name,
                  m.type, convert_from(m.ciphertext, 'UTF8') AS ciphertext,
                  m.deleted_at, m.created_at
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC LIMIT 1
         ) sub
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'user_id', u.id, 'username', u.username, 'display_name', u.display_name,
           'avatar_url', u.avatar_url, 'role', cm2.role, 'joined_at', cm2.joined_at
         )) AS members
         FROM conversation_members cm2
         JOIN users u ON u.id = cm2.user_id
         WHERE cm2.conversation_id = c.id
       ) mem ON true
       ORDER BY c.updated_at DESC`,
      [userId],
    );
    return r.rows;
  }

  async getConversation(id: string, userId: string) {
    await this.assertMember(id, userId);
    const r = await this.db.query(
      `SELECT c.*,
         json_agg(json_build_object(
           'user_id', u.id, 'username', u.username, 'display_name', u.display_name,
           'avatar_url', u.avatar_url, 'role', cm.role, 'joined_at', cm.joined_at
         )) AS members
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       JOIN users u ON u.id = cm.user_id
       WHERE c.id = $1
       GROUP BY c.id`,
      [id],
    );
    if (!r.rows[0]) throw new NotFoundException('Conversation not found');
    return r.rows[0];
  }

  async createConversation(userId: string, body: {
    type: string; name?: string; description?: string; memberIds?: string[]; teamId?: string;
  }) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO conversations (type, name, description, team_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [body.type, body.name ?? null, body.description ?? null, body.teamId ?? null, userId],
    );
    const convId = r.rows[0].id;
    const members = [userId, ...(body.memberIds ?? [])];
    for (const memberId of members) {
      await this.db.query(
        'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [convId, memberId, memberId === userId ? 'owner' : 'member'],
      );
    }
    return this.getConversation(convId, userId);
  }

  async listPinnedMessages(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const r = await this.db.query(
      `SELECT pm.message_id    AS "messageId",
              pm.pinned_at     AS "pinnedAt",
              pu.display_name  AS "pinnedByName",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              u.display_name   AS "senderDisplayName"
       FROM pinned_messages pm
       JOIN messages m ON m.id = pm.message_id
       JOIN users u ON u.id = m.sender_id
       JOIN users pu ON pu.id = pm.pinned_by
       WHERE pm.conversation_id = $1
       ORDER BY pm.pinned_at DESC`,
      [conversationId],
    );
    return r.rows;
  }

  async getMedia(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const r = await this.db.query(
      `SELECT m.id AS "messageId", m.type, m.created_at AS "createdAt",
              json_build_object(
                'id', f.id, 'fileName', f.file_name, 'mimeType', f.mime_type,
                'sizeBytes', f.size_bytes, 'hasThumbnail', f.has_thumbnail,
                'durationSecs', f.duration_secs, 'createdAt', f.created_at
              ) AS file
       FROM messages m
       JOIN files f ON f.message_id = m.id
       WHERE m.conversation_id = $1
         AND m.type IN ('image', 'video')
         AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
      [conversationId],
    );
    return r.rows;
  }

  async getAttachments(conversationId: string, userId: string, types: string[]) {
    await this.assertMember(conversationId, userId);
    const r = await this.db.query(
      `SELECT m.id AS "messageId", m.type, m.created_at AS "createdAt", m.sender_id AS "senderId",
              json_build_object(
                'id', f.id, 'fileName', f.file_name, 'mimeType', f.mime_type,
                'sizeBytes', f.size_bytes, 'hasThumbnail', f.has_thumbnail,
                'durationSecs', f.duration_secs, 'createdAt', f.created_at
              ) AS file
       FROM messages m
       JOIN files f ON f.message_id = m.id
       WHERE m.conversation_id = $1
         AND m.type::text = ANY($2::text[])
         AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC`,
      [conversationId, types],
    );
    return r.rows;
  }

  async pinMessage(conversationId: string, messageId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    await this.db.query(
      'INSERT INTO pinned_messages (conversation_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [conversationId, messageId, userId],
    );
  }

  async unpinMessage(conversationId: string, messageId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    await this.db.query(
      'DELETE FROM pinned_messages WHERE conversation_id = $1 AND message_id = $2',
      [conversationId, messageId],
    );
  }

  async muteConversation(conversationId: string, userId: string, muted: boolean) {
    await this.db.query(
      `UPDATE conversation_members
       SET muted_until = CASE WHEN $1 THEN (now() + interval '100 years') ELSE NULL END
       WHERE conversation_id = $2 AND user_id = $3`,
      [muted, conversationId, userId],
    );
  }
}
