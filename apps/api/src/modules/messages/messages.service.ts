import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class MessagesService {
  constructor(private readonly db: DatabaseService) {}

  async listMessages(conversationId: string, userId: string, before?: string, limit = 50) {
    const r = await this.db.query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.ciphertext,
              m.reply_to_message_id, m.forwarded_from_message_id, m.created_at, m.edited_at, m.deleted_at,
              to_json(f) AS file,
              COALESCE(
                json_agg(json_build_object(
                  'emoji', mr.emoji, 'userId', mr.user_id,
                  'username', u2.username, 'displayName', u2.display_name
                )) FILTER (WHERE mr.emoji IS NOT NULL), '[]'
              ) AS reactions
       FROM messages m
       LEFT JOIN files f ON f.id = m.file_id
       LEFT JOIN message_reactions mr ON mr.message_id = m.id
       LEFT JOIN users u2 ON u2.id = mr.user_id
       WHERE m.conversation_id = $1
         AND ($2::uuid IS NULL OR m.created_at < (SELECT created_at FROM messages WHERE id = $2::uuid))
       GROUP BY m.id, f.id
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [conversationId, before ?? null, limit],
    );
    return r.rows.reverse();
  }

  async sendMessage(conversationId: string, senderId: string, data: {
    type: string; ciphertext: string; replyToMessageId?: string; fileId?: string;
  }) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, type, ciphertext, reply_to_message_id, file_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [conversationId, senderId, data.type, data.ciphertext, data.replyToMessageId ?? null, data.fileId ?? null],
    );
    await this.db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
    return { id: r.rows[0].id };
  }

  async editMessage(messageId: string, userId: string, ciphertext: string) {
    const r = await this.db.query<{ conversation_id: string }>(
      `UPDATE messages SET ciphertext = $1, edited_at = now()
       WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
       RETURNING conversation_id`,
      [ciphertext, messageId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Cannot edit this message');
    return { id: messageId, conversationId: r.rows[0].conversation_id, ciphertext, editedAt: new Date().toISOString() };
  }

  async deleteMessage(messageId: string, userId: string) {
    const r = await this.db.query<{ conversation_id: string }>(
      `UPDATE messages SET deleted_at = now()
       WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
       RETURNING conversation_id`,
      [messageId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Cannot delete this message');
    return { id: messageId, conversationId: r.rows[0].conversation_id, deletedAt: new Date().toISOString() };
  }

  async reactToMessage(messageId: string, userId: string, emoji: string | null) {
    if (emoji) {
      await this.db.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [messageId, userId, emoji],
      );
    } else {
      await this.db.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
        [messageId, userId],
      );
    }
  }

  async markRead(conversationId: string, userId: string) {
    await this.db.query(
      'UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
  }
}
