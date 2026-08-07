import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { message_type } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** ciphertext is bytea; the SQL form decoded it with convert_from(…, 'UTF8'). */
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

type FileRow = {
  id: string; file_name: string; mime_type: string; size_bytes: bigint;
  has_thumbnail: boolean; duration_secs: number | null; created_at: Date;
};

/** Mirrors the FILE_JSON json_build_object: null when the message carries no file. */
const fileDto = (files: FileRow[]) => {
  const f = files[0];
  if (!f) return null;
  return {
    id: f.id,
    fileName: f.file_name,
    mimeType: f.mime_type,
    sizeBytes: Number(f.size_bytes),
    hasThumbnail: f.has_thumbnail,
    durationSecs: f.duration_secs,
    createdAt: f.created_at,
  };
};

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMember(conversationId: string, userId: string, message = 'Not a member of this conversation') {
    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException(message);
  }

  private async conversationIdOf(messageId: string, requireLive = false) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
      select: { conversation_id: true, deleted_at: true },
    });
    if (!message || (requireLive && message.deleted_at)) throw new NotFoundException('Message not found');
    return message.conversation_id;
  }

  async listMessages(conversationId: string, userId: string, before?: string, limit = 50) {
    await this.assertMember(conversationId, userId);

    // Keyset pagination: the SQL resolved `before` to that message's timestamp in a subquery,
    // scoped to this conversation so an id from elsewhere cannot shift the window.
    let cutoff: Date | undefined;
    if (before) {
      const anchor = await this.prisma.messages.findFirst({
        where: { id: before, conversation_id: conversationId },
        select: { created_at: true },
      });
      // No anchor means the SQL's subquery yielded NULL and the predicate dropped every row.
      if (!anchor) return [];
      cutoff = anchor.created_at;
    }

    const rows = await this.prisma.messages.findMany({
      where: { conversation_id: conversationId, ...(cutoff ? { created_at: { lt: cutoff } } : {}) },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true, conversation_id: true, sender_id: true, type: true, ciphertext: true,
        reply_to_message_id: true, forwarded_from_message_id: true,
        created_at: true, edited_at: true, deleted_at: true,
        files: true,
        message_reactions: {
          select: {
            emoji: true,
            user_id: true,
            users: { select: { username: true, display_name: true } },
          },
        },
      },
    });

    return rows
      .map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        type: m.type,
        ciphertext: decode(m.ciphertext),
        replyToMessageId: m.reply_to_message_id,
        forwardedFromMessageId: m.forwarded_from_message_id,
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
        file: fileDto(m.files),
        reactions: m.message_reactions.map((r) => ({
          emoji: r.emoji,
          userId: r.user_id,
          username: r.users.username,
          displayName: r.users.display_name,
        })),
      }))
      .reverse();
  }

  async sendMessage(conversationId: string, senderId: string, data: {
    type?: string; ciphertext?: string; replyToMessageId?: string; fileId?: string;
  }) {
    await this.assertMember(conversationId, senderId);

    const created = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: senderId,
        type: (data.type ?? 'text') as message_type,
        ciphertext: Buffer.from(data.ciphertext ?? '', 'utf8'),
        reply_to_message_id: data.replyToMessageId ?? null,
      },
      select: { id: true },
    });

    if (data.fileId) {
      // Scoped by uploader_id and message_id IS NULL: you cannot attach someone else's upload,
      // nor re-attach a file already bound to another message.
      await this.prisma.files.updateMany({
        where: { id: data.fileId, uploader_id: senderId, message_id: null },
        data: { message_id: created.id },
      });
    }

    await this.prisma.conversations.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    });

    const m = await this.prisma.messages.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        id: true, conversation_id: true, sender_id: true, type: true, ciphertext: true,
        reply_to_message_id: true, created_at: true, edited_at: true, deleted_at: true,
        files: true,
      },
    });

    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      type: m.type,
      ciphertext: decode(m.ciphertext),
      replyToMessageId: m.reply_to_message_id,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      file: fileDto(m.files),
    };
  }

  async editMessage(messageId: string, userId: string, ciphertext: string) {
    // Guarded by the same predicate the UPDATE … WHERE carried: own message, not deleted.
    const result = await this.prisma.messages.updateMany({
      where: { id: messageId, sender_id: userId, deleted_at: null },
      data: { ciphertext: Buffer.from(ciphertext, 'utf8'), edited_at: new Date() },
    });
    if (result.count === 0) throw new ForbiddenException('Cannot edit this message');

    const m = await this.prisma.messages.findUniqueOrThrow({
      where: { id: messageId },
      select: {
        id: true, conversation_id: true, sender_id: true, type: true,
        ciphertext: true, created_at: true, edited_at: true,
      },
    });
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      type: m.type,
      ciphertext: decode(m.ciphertext),
      createdAt: m.created_at,
      editedAt: m.edited_at,
    };
  }

  async deleteMessage(messageId: string, userId: string) {
    const deletedAt = new Date();
    const result = await this.prisma.messages.updateMany({
      where: { id: messageId, sender_id: userId, deleted_at: null },
      // Body is blanked, not just flagged, so the text cannot be recovered from the row.
      data: { deleted_at: deletedAt, ciphertext: Buffer.alloc(0) },
    });
    if (result.count === 0) throw new ForbiddenException('Cannot delete this message');

    const m = await this.prisma.messages.findUniqueOrThrow({
      where: { id: messageId },
      select: { id: true, conversation_id: true, deleted_at: true },
    });
    return { id: m.id, conversationId: m.conversation_id, deletedAt: m.deleted_at };
  }

  async addReaction(messageId: string, userId: string, emoji: string) {
    const conversationId = await this.conversationIdOf(messageId, true);
    await this.assertMember(conversationId, userId);

    await this.prisma.message_reactions.upsert({
      where: { message_id_user_id_emoji: { message_id: messageId, user_id: userId, emoji } },
      update: {},
      create: { message_id: messageId, user_id: userId, emoji },
    });
  }

  async removeReaction(messageId: string, userId: string, emoji: string) {
    await this.prisma.message_reactions.deleteMany({
      where: { message_id: messageId, user_id: userId, emoji },
    });
  }

  async markRead(messageId: string, userId: string) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
      select: { conversation_id: true },
    });
    // The SQL's subquery returned NULL for an unknown message, so the UPDATE matched nothing.
    if (!message) return;

    await this.prisma.conversation_members.updateMany({
      where: { conversation_id: message.conversation_id, user_id: userId },
      data: { last_read_message_id: messageId },
    });
  }

  /**
   * Raw: the search matches against convert_from(ciphertext, 'UTF8'), i.e. the decoded body of a
   * bytea column. Prisma's filters operate on the stored bytes, so there is no builder equivalent
   * — and decoding every message in the process to filter in JS is not an option at this size.
   */
  async searchMessages(q: string, userId: string, conversationId?: string) {
    const pattern = `%${q.replace(/[!%_]/g, '!$&')}%`;
    return this.prisma.$queryRaw<unknown[]>`
      SELECT m.id,
             m.conversation_id AS "conversationId",
             m.sender_id       AS "senderId",
             m.type,
             convert_from(m.ciphertext, 'UTF8') AS ciphertext,
             m.created_at AS "createdAt",
             m.edited_at  AS "editedAt",
             m.deleted_at AS "deletedAt"
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}::uuid
      WHERE m.deleted_at IS NULL
        AND convert_from(m.ciphertext, 'UTF8') ILIKE ${pattern} ESCAPE '!'
        AND (${conversationId ?? null}::uuid IS NULL OR m.conversation_id = ${conversationId ?? null}::uuid)
      ORDER BY m.created_at DESC
      LIMIT 50`;
  }

  async listPinned(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId, 'Not a member');

    const rows = await this.prisma.pinned_messages.findMany({
      // Both users joins were INNER, so pins by a deleted user or of a senderless message
      // were excluded.
      where: {
        conversation_id: conversationId,
        pinned_by: { not: null },
        messages: { sender_id: { not: null } },
      },
      orderBy: { pinned_at: 'desc' },
      select: {
        message_id: true,
        pinned_at: true,
        users: { select: { display_name: true } },
        messages: {
          select: {
            type: true,
            ciphertext: true,
            users_messages_sender_idTousers: { select: { display_name: true } },
          },
        },
      },
    });

    return rows.map((p) => ({
      messageId: p.message_id,
      pinnedAt: p.pinned_at,
      pinnedByName: p.users?.display_name ?? '',
      type: p.messages.type,
      ciphertext: decode(p.messages.ciphertext),
      senderDisplayName: p.messages.users_messages_sender_idTousers?.display_name ?? '',
    }));
  }

  async pinMessage(messageId: string, userId: string) {
    const conversationId = await this.conversationIdOf(messageId);
    await this.assertMember(conversationId, userId);

    await this.prisma.pinned_messages.upsert({
      where: { conversation_id_message_id: { conversation_id: conversationId, message_id: messageId } },
      update: {},
      create: { conversation_id: conversationId, message_id: messageId, pinned_by: userId },
    });
    return { conversationId, messageId };
  }

  async unpinMessage(messageId: string, userId: string) {
    const conversationId = await this.conversationIdOf(messageId);
    await this.prisma.pinned_messages.deleteMany({
      where: { conversation_id: conversationId, message_id: messageId },
    });
    return { conversationId, messageId };
  }

  async listBookmarks(userId: string, conversationId?: string) {
    const rows = await this.prisma.user_bookmarks.findMany({
      where: {
        user_id: userId,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        // users was INNER JOINed on m.sender_id, which is nullable.
        messages: { sender_id: { not: null } },
      },
      orderBy: { created_at: 'desc' },
      select: {
        message_id: true,
        created_at: true,
        messages: {
          select: {
            type: true,
            ciphertext: true,
            users_messages_sender_idTousers: { select: { display_name: true } },
          },
        },
      },
    });

    return rows.map((b) => ({
      messageId: b.message_id,
      savedAt: b.created_at,
      type: b.messages.type,
      ciphertext: decode(b.messages.ciphertext),
      senderDisplayName: b.messages.users_messages_sender_idTousers?.display_name ?? '',
    }));
  }

  async bookmarkMessage(messageId: string, userId: string) {
    const conversationId = await this.conversationIdOf(messageId);
    await this.assertMember(conversationId, userId);

    await this.prisma.user_bookmarks.upsert({
      where: { user_id_message_id: { user_id: userId, message_id: messageId } },
      update: {},
      create: { user_id: userId, message_id: messageId, conversation_id: conversationId },
    });
    return { messageId };
  }

  async unbookmarkMessage(messageId: string, userId: string) {
    await this.prisma.user_bookmarks.deleteMany({ where: { user_id: userId, message_id: messageId } });
    return { messageId };
  }

  async forwardMessage(messageId: string, userId: string, targetConversationId: string) {
    const original = await this.prisma.messages.findUnique({
      where: { id: messageId },
      select: { type: true, ciphertext: true, sender_id: true, conversation_id: true },
    });
    if (!original) throw new NotFoundException('Message not found');

    await this.assertMember(original.conversation_id, userId, 'Not a member of source conversation');
    await this.assertMember(targetConversationId, userId, 'Not a member of target conversation');

    const created = await this.prisma.messages.create({
      data: {
        conversation_id: targetConversationId,
        sender_id: userId,
        type: original.type,
        ciphertext: Buffer.from(original.ciphertext),
        forwarded_from_message_id: messageId,
        original_sender_id: original.sender_id,
      },
      select: { id: true },
    });

    await this.prisma.conversations.update({
      where: { id: targetConversationId },
      data: { updated_at: new Date() },
    });

    return { id: created.id, conversationId: targetConversationId };
  }

  /**
   * Raw for the same reason as listConversations: the cutoff is that member's own last-read
   * message timestamp, so it differs per conversation and cannot be expressed as one filter.
   */
  async listUndelivered(userId: string) {
    return this.prisma.$queryRaw<unknown[]>`
      SELECT m.id,
             m.conversation_id AS "conversationId",
             m.sender_id       AS "senderId",
             m.type,
             convert_from(m.ciphertext, 'UTF8') AS ciphertext,
             m.created_at AS "createdAt"
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}::uuid
      WHERE m.sender_id != ${userId}::uuid
        AND m.deleted_at IS NULL
        AND (cm.last_read_message_id IS NULL OR
             m.created_at > (SELECT created_at FROM messages lrm WHERE lrm.id = cm.last_read_message_id))
      ORDER BY m.created_at ASC
      LIMIT 200`;
  }
}
