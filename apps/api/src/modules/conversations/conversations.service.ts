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
      `SELECT c.*, cm.is_muted,
         (SELECT COUNT(*) FROM messages m
          WHERE m.conversation_id = c.id AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')
          AND m.sender_id != $1 AND m.deleted_at IS NULL) AS unread_count,
         (SELECT row_to_json(lm) FROM (
           SELECT u.username AS sender_username, u.display_name AS sender_display_name,
                  m.type, m.ciphertext, m.deleted_at, m.created_at
           FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1
         ) lm) AS last_message
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
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
    return { id: convId };
  }

  async listPinnedMessages(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const r = await this.db.query(
      `SELECT pm.message_id, m.type, m.ciphertext, u.display_name AS sender_display_name,
              pm.created_at AS pinned_at, pu.display_name AS pinned_by_name
       FROM pinned_messages pm
       JOIN messages m ON m.id = pm.message_id
       JOIN users u ON u.id = m.sender_id
       JOIN users pu ON pu.id = pm.pinned_by
       WHERE pm.conversation_id = $1
       ORDER BY pm.created_at DESC`,
      [conversationId],
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
      'UPDATE conversation_members SET is_muted = $1 WHERE conversation_id = $2 AND user_id = $3',
      [muted, conversationId, userId],
    );
  }
}
