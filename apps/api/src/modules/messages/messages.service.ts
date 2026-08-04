import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

const FILE_JSON = `
  CASE WHEN f.id IS NOT NULL THEN json_build_object(
    'id', f.id, 'fileName', f.file_name, 'mimeType', f.mime_type,
    'sizeBytes', f.size_bytes, 'hasThumbnail', f.has_thumbnail,
    'durationSecs', f.duration_secs, 'createdAt', f.created_at
  ) ELSE NULL END
`;

@Injectable()
export class MessagesService {
  constructor(private readonly db: DatabaseService) {}

  async listMessages(conversationId: string, userId: string, before?: string, limit = 50) {
    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member of this conversation');

    const r = await this.db.query(
      `SELECT m.id,
              m.conversation_id AS "conversationId",
              m.sender_id       AS "senderId",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              m.reply_to_message_id              AS "replyToMessageId",
              m.forwarded_from_message_id        AS "forwardedFromMessageId",
              m.created_at  AS "createdAt",
              m.edited_at   AS "editedAt",
              m.deleted_at  AS "deletedAt",
              ${FILE_JSON} AS file,
              COALESCE(
                json_agg(json_build_object(
                  'emoji', mr.emoji, 'userId', mr.user_id,
                  'username', u2.username, 'displayName', u2.display_name
                )) FILTER (WHERE mr.emoji IS NOT NULL), '[]'
              ) AS reactions
       FROM messages m
       LEFT JOIN files f ON f.message_id = m.id
       LEFT JOIN message_reactions mr ON mr.message_id = m.id
       LEFT JOIN users u2 ON u2.id = mr.user_id
       WHERE m.conversation_id = $1
         AND ($2::uuid IS NULL OR m.created_at < (
               SELECT created_at FROM messages WHERE id = $2::uuid AND conversation_id = $1
             ))
       GROUP BY m.id, f.id
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [conversationId, before ?? null, limit],
    );
    return r.rows.reverse();
  }

  async sendMessage(conversationId: string, senderId: string, data: {
    type?: string; ciphertext?: string; replyToMessageId?: string; fileId?: string;
  }) {
    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, senderId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member of this conversation');

    const ciphertextBytes = data.ciphertext
      ? Buffer.from(data.ciphertext, 'utf8')
      : Buffer.from('', 'utf8');

    const r = await this.db.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, type, ciphertext, reply_to_message_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [conversationId, senderId, data.type ?? 'text', ciphertextBytes, data.replyToMessageId ?? null],
    );
    const messageId = r.rows[0].id;

    // Attach file — enforce uploader ownership and prevent double-attach
    if (data.fileId) {
      await this.db.query(
        'UPDATE files SET message_id = $1 WHERE id = $2 AND uploader_id = $3 AND message_id IS NULL',
        [messageId, data.fileId, senderId],
      );
    }

    await this.db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);

    const msg = await this.db.query(
      `SELECT m.id,
              m.conversation_id AS "conversationId",
              m.sender_id       AS "senderId",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              m.reply_to_message_id AS "replyToMessageId",
              m.created_at  AS "createdAt",
              m.edited_at   AS "editedAt",
              m.deleted_at  AS "deletedAt",
              ${FILE_JSON} AS file
       FROM messages m
       LEFT JOIN files f ON f.message_id = m.id
       WHERE m.id = $1`,
      [messageId],
    );
    return msg.rows[0];
  }

  async editMessage(messageId: string, userId: string, ciphertext: string) {
    const r = await this.db.query(
      `UPDATE messages SET ciphertext = $1, edited_at = now()
       WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
       RETURNING id,
                 conversation_id AS "conversationId",
                 sender_id AS "senderId",
                 type,
                 convert_from(ciphertext, 'UTF8') AS ciphertext,
                 created_at AS "createdAt",
                 edited_at  AS "editedAt"`,
      [Buffer.from(ciphertext, 'utf8'), messageId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Cannot edit this message');
    return r.rows[0];
  }

  async deleteMessage(messageId: string, userId: string) {
    const r = await this.db.query(
      `UPDATE messages SET deleted_at = now(), ciphertext = ''::bytea
       WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
       RETURNING id, conversation_id AS "conversationId", deleted_at AS "deletedAt"`,
      [messageId, userId],
    );
    if (!r.rows[0]) throw new ForbiddenException('Cannot delete this message');
    return r.rows[0];
  }

  async addReaction(messageId: string, userId: string, emoji: string) {
    const r = await this.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM messages WHERE id = $1 AND deleted_at IS NULL',
      [messageId],
    );
    if (!r.rows[0]) throw new NotFoundException('Message not found');
    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [r.rows[0].conversation_id, userId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member of this conversation');

    await this.db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [messageId, userId, emoji],
    );
  }

  async removeReaction(messageId: string, userId: string, emoji: string) {
    await this.db.query(
      'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [messageId, userId, emoji],
    );
  }

  async markRead(messageId: string, userId: string) {
    await this.db.query(
      `UPDATE conversation_members
       SET last_read_message_id = $1
       WHERE conversation_id = (SELECT conversation_id FROM messages WHERE id = $1)
         AND user_id = $2`,
      [messageId, userId],
    );
  }

  async searchMessages(q: string, userId: string, conversationId?: string) {
    const escaped = q.replace(/[!%_]/g, '!$&');
    const r = await this.db.query(
      `SELECT m.id,
              m.conversation_id AS "conversationId",
              m.sender_id       AS "senderId",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              m.created_at AS "createdAt",
              m.edited_at  AS "editedAt",
              m.deleted_at AS "deletedAt"
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
       WHERE m.deleted_at IS NULL
         AND convert_from(m.ciphertext, 'UTF8') ILIKE $1 ESCAPE '!'
         AND ($3::uuid IS NULL OR m.conversation_id = $3::uuid)
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [`%${escaped}%`, userId, conversationId ?? null],
    );
    return r.rows;
  }

  async listPinned(conversationId: string, userId: string) {
    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member');

    const r = await this.db.query(
      `SELECT pm.message_id  AS "messageId",
              pm.pinned_at   AS "pinnedAt",
              pu.display_name AS "pinnedByName",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              u.display_name AS "senderDisplayName"
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

  async pinMessage(messageId: string, userId: string) {
    const r = await this.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM messages WHERE id = $1',
      [messageId],
    );
    if (!r.rows[0]) throw new NotFoundException('Message not found');
    const conversationId = r.rows[0].conversation_id;

    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member of this conversation');

    await this.db.query(
      'INSERT INTO pinned_messages (conversation_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [conversationId, messageId, userId],
    );
    return { conversationId, messageId };
  }

  async unpinMessage(messageId: string, userId: string) {
    const r = await this.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM messages WHERE id = $1',
      [messageId],
    );
    if (!r.rows[0]) throw new NotFoundException('Message not found');
    const conversationId = r.rows[0].conversation_id;

    await this.db.query(
      'DELETE FROM pinned_messages WHERE conversation_id = $1 AND message_id = $2',
      [conversationId, messageId],
    );
    return { conversationId, messageId };
  }

  async listBookmarks(userId: string, conversationId?: string) {
    const r = await this.db.query(
      `SELECT ub.message_id  AS "messageId",
              ub.created_at  AS "savedAt",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              u.display_name AS "senderDisplayName"
       FROM user_bookmarks ub
       JOIN messages m ON m.id = ub.message_id
       JOIN users u ON u.id = m.sender_id
       WHERE ub.user_id = $1
         AND ($2::uuid IS NULL OR ub.conversation_id = $2::uuid)
       ORDER BY ub.created_at DESC`,
      [userId, conversationId ?? null],
    );
    return r.rows;
  }

  async bookmarkMessage(messageId: string, userId: string) {
    const r = await this.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM messages WHERE id = $1',
      [messageId],
    );
    if (!r.rows[0]) throw new NotFoundException('Message not found');

    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [r.rows[0].conversation_id, userId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member of this conversation');

    await this.db.query(
      `INSERT INTO user_bookmarks (user_id, message_id, conversation_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, messageId, r.rows[0].conversation_id],
    );
    return { messageId };
  }

  async unbookmarkMessage(messageId: string, userId: string) {
    await this.db.query(
      'DELETE FROM user_bookmarks WHERE user_id = $1 AND message_id = $2',
      [userId, messageId],
    );
    return { messageId };
  }

  async forwardMessage(messageId: string, userId: string, targetConversationId: string) {
    const orig = await this.db.query(
      `SELECT type, ciphertext, sender_id, conversation_id FROM messages WHERE id = $1`,
      [messageId],
    );
    if (!orig.rows[0]) throw new NotFoundException('Message not found');

    const srcMem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [orig.rows[0].conversation_id, userId],
    );
    if (!srcMem.rows[0]) throw new ForbiddenException('Not a member of source conversation');

    const mem = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [targetConversationId, userId],
    );
    if (!mem.rows[0]) throw new ForbiddenException('Not a member of target conversation');

    const r = await this.db.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, type, ciphertext, forwarded_from_message_id, original_sender_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [targetConversationId, userId, orig.rows[0].type, orig.rows[0].ciphertext, messageId, orig.rows[0].sender_id],
    );
    await this.db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [targetConversationId]);
    return { id: r.rows[0].id, conversationId: targetConversationId };
  }

  async listUndelivered(userId: string) {
    const r = await this.db.query(
      `SELECT m.id,
              m.conversation_id AS "conversationId",
              m.sender_id       AS "senderId",
              m.type,
              convert_from(m.ciphertext, 'UTF8') AS ciphertext,
              m.created_at AS "createdAt"
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
       WHERE m.sender_id != $1
         AND m.deleted_at IS NULL
         AND (cm.last_read_message_id IS NULL OR
              m.created_at > (SELECT created_at FROM messages lrm WHERE lrm.id = cm.last_read_message_id))
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [userId],
    );
    return r.rows;
  }
}
