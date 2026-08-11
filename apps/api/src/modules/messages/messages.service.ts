import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { message_type } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service';

/**
 * What a client may send.
 *
 * `system` is deliberately absent from the types: the server writes those to narrate events like
 * someone joining a group, and a client able to post one could forge that narration.
 */
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(['text', 'image', 'video', 'audio', 'file']).optional(),
  ciphertext: z.string().optional(),
  // `nullish`, not `optional`: "no reply" and "no attachment" are absences a client may express as
  // either a missing key or an explicit null, and refusing one of the two spellings would be a
  // validation error about nothing. Both are read as absent below.
  replyToMessageId: z.string().uuid().nullish(),
  fileId: z.string().uuid().nullish(),
});

/** ciphertext is bytea; the SQL form decoded it with convert_from(…, 'UTF8'). */
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

/**
 * How many recent messages a search reads before giving up.
 *
 * Matching cannot happen in SQL (see searchMessages), so the scan is bounded rather than
 * unlimited. Well beyond any conversation in this deployment, and small enough that a search
 * cannot pull the table into memory.
 */
const SEARCH_SCAN_LIMIT = 4000;
const SEARCH_RESULT_LIMIT = 50;

const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The text a person actually typed, from what the column holds.
 *
 * The web client base64-encodes message bodies before sending, so the stored bytes are the
 * base64 *string*, not the words. Messages predating that still hold plain UTF-8, and the client
 * has always fallen back for them — this mirrors that, and returns both readings so a caller can
 * match either without having to guess which era a row came from.
 */
export function searchableText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('utf8');
  if (raw.length === 0 || raw.length % 4 !== 0 || !BASE64_SHAPE.test(raw)) return raw;

  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  // A plain word can look like base64 — "test" is four valid characters. Decoding one produces
  // bytes that are not valid UTF-8, which surfaces as replacement characters; that row was never
  // encoded, so match its text as written.
  if (decoded.includes('�')) return raw;

  // Only the decoded text. Searching the base64 as well would let a short query match arbitrary
  // alphanumeric runs inside the encoding — "the" appears in plenty of base64 that does not
  // contain the word — and every hit would be one the reader cannot see in the message.
  return decoded;
}

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
  /**
   * Emits 'message:new' with a fully-shaped message so the gateway can broadcast it.
   *
   * RealtimeModule imports MessagesModule, so this service cannot hold the gateway without a
   * circular dependency — the gateway subscribes instead. Messages sent over the socket are
   * already broadcast by the gateway itself; this exists for the ones created over HTTP.
   */
  readonly events = new EventEmitter();

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
        // Drives the "Forwarded from …" label; without it the UI condition never passes.
        users_messages_original_sender_idTousers: { select: { display_name: true } },
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
        forwardedFromDisplayName: m.users_messages_original_sender_idTousers?.display_name ?? null,
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

  async sendMessage(conversationId: string, senderId: string, data: unknown) {
    // Parsed here rather than in the controller because the socket gateway calls this method
    // directly — a schema on the HTTP route alone would leave `message:send` unguarded, which is
    // the transport most sends actually use.
    const body = sendMessageSchema.parse({ ...(data as object), conversationId });

    await this.assertMember(conversationId, senderId);

    // A reply to a message that does not exist used to reach the foreign key and come back as 500.
    // Checking the conversation too, because quoting a message out of a thread you are in from one
    // you are not would surface its text in the reply preview.
    if (body.replyToMessageId) {
      const parent = await this.prisma.messages.findUnique({
        where: { id: body.replyToMessageId },
        select: { conversation_id: true },
      });
      if (!parent || parent.conversation_id !== conversationId) {
        throw new BadRequestException('The message being replied to is not in this conversation');
      }
    }

    // Scoped by uploader_id and message_id IS NULL: you cannot attach someone else's upload, nor
    // re-attach a file already bound to another message. Checked before the message row is written
    // — the previous order created the message first and updated nothing when the file did not
    // match, which answered 201 and left an image bubble with no image in it.
    if (body.fileId) {
      const file = await this.prisma.files.findFirst({
        where: { id: body.fileId, uploader_id: senderId, message_id: null },
        select: { id: true },
      });
      if (!file) throw new BadRequestException('That attachment does not exist, or is already attached to a message');
    }

    const created = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: senderId,
        type: (body.type ?? 'text') as message_type,
        ciphertext: Buffer.from(body.ciphertext ?? '', 'utf8'),
        reply_to_message_id: body.replyToMessageId ?? null,
      },
      select: { id: true },
    });

    if (body.fileId) {
      await this.prisma.files.updateMany({
        where: { id: body.fileId, uploader_id: senderId, message_id: null },
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

    const message = {
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

    // Announced here rather than by whichever transport carried the send. Only forwarding used
    // to emit, so a message posted over HTTP — which is what the web client falls back to
    // whenever its socket is down — was stored and delivered to nobody.
    this.events.emit('message:new', message);
    return message;
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

  /**
   * Deleting is an admin action, and the rule lives here.
   *
   * The clause used to be `sender_id: userId`, which disagreed with the interface in both
   * directions: an admin pressing Delete on someone else's message was refused, while any
   * signed-in user could still delete their own through the HTTP route or the socket event —
   * the button being hidden stops neither.
   *
   * The role is read from the row rather than the JWT: a token issued before someone was
   * demoted still carries `role: 'admin'` until it expires.
   */
  async deleteMessage(messageId: string, userId: string) {
    const actor = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (actor?.role !== 'admin') {
      throw new ForbiddenException('Only an admin can delete a message');
    }

    const deletedAt = new Date();
    const result = await this.prisma.messages.updateMany({
      where: { id: messageId, deleted_at: null },
      // Body is blanked, not just flagged, so the text cannot be recovered from the row.
      data: { deleted_at: deletedAt, ciphertext: Buffer.alloc(0) },
    });
    if (result.count === 0) throw new NotFoundException('Message not found, or already deleted');

    const m = await this.prisma.messages.findUniqueOrThrow({
      where: { id: messageId },
      select: { id: true, conversation_id: true, deleted_at: true },
    });
    return { id: m.id, conversationId: m.conversation_id, deletedAt: m.deleted_at };
  }

  /**
   * Reactions announce themselves from here, not from whichever transport carried them.
   *
   * The broadcast used to live only in the WebSocket handler, while the web client reacts over
   * HTTP — so a reaction reached the database and nobody else's screen. Emitting where the change
   * is made means both routes behave the same, and neither can forget to.
   */
  async addReaction(messageId: string, userId: string, emoji: string) {
    const conversationId = await this.conversationIdOf(messageId, true);
    await this.assertMember(conversationId, userId);

    await this.prisma.message_reactions.upsert({
      where: { message_id_user_id_emoji: { message_id: messageId, user_id: userId, emoji } },
      update: {},
      create: { message_id: messageId, user_id: userId, emoji },
    });

    const who = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { username: true, display_name: true },
    });
    this.events.emit('reaction:added', {
      messageId,
      conversationId,
      userId,
      emoji,
      username: who?.username ?? '',
      displayName: who?.display_name ?? '',
    });
  }

  async removeReaction(messageId: string, userId: string, emoji: string) {
    // Resolved before the delete, so the broadcast still has a destination once the row is gone.
    const conversationId = await this.conversationIdOf(messageId);

    const { count } = await this.prisma.message_reactions.deleteMany({
      where: { message_id: messageId, user_id: userId, emoji },
    });
    // Nothing was removed — a double tap, or a client working from a stale view. Announcing it
    // would tell everyone to drop a reaction that was never there.
    if (count === 0) return;

    this.events.emit('reaction:removed', { messageId, conversationId, userId, emoji });
  }

  /**
   * Record how far a member has read, and tell the conversation.
   *
   * Read state is one cutoff per member rather than a row per message, so this only ever moves
   * forward: the client marks what it can see, those arrive in no particular order, and a blind
   * write would drag the cutoff backwards and resurface messages as unread.
   */
  async markRead(messageId: string, userId: string) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
      select: { conversation_id: true, created_at: true },
    });
    // The SQL's subquery returned NULL for an unknown message, so the UPDATE matched nothing.
    if (!message) return;

    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: message.conversation_id, user_id: userId } },
      select: { last_read_message_id: true },
    });
    if (!member) return;

    if (member.last_read_message_id) {
      if (member.last_read_message_id === messageId) return;
      const current = await this.prisma.messages.findUnique({
        where: { id: member.last_read_message_id },
        select: { created_at: true },
      });
      if (current && current.created_at >= message.created_at) return;
    }

    await this.prisma.conversation_members.update({
      where: { conversation_id_user_id: { conversation_id: message.conversation_id, user_id: userId } },
      data: { last_read_message_id: messageId },
    });

    // Announced only when the cutoff actually advanced, so re-opening a conversation that is
    // already read is silent rather than a burst of events saying nothing new.
    this.events.emit('message:read', {
      messageId,
      conversationId: message.conversation_id,
      userId,
      // The cutoff this moves them to. Sent alongside so a client can update its record without
      // needing that message to be one it has loaded.
      readAt: message.created_at,
    });
  }

  /**
   * Raw: the search matches against convert_from(ciphertext, 'UTF8'), i.e. the decoded body of a
   * bytea column. Prisma's filters operate on the stored bytes, so there is no builder equivalent
   * — and decoding every message in the process to filter in JS is not an option at this size.
   */
  /**
   * Find messages containing `q`.
   *
   * This cannot be an ILIKE in SQL. Bodies are stored base64-encoded, so the column holds
   * "emVicmFjcm9zc2luZw==" where the person typed "zebracrossing" — comparing the query against
   * it matched the encoding rather than the words, and searching for anything a user would type
   * returned nothing at all.
   *
   * So the rows are decoded here and matched in memory, bounded by SEARCH_SCAN_LIMIT. Membership
   * is still enforced by the query, not by the filter, so the scan can only ever see
   * conversations the caller belongs to.
   *
   * `ciphertext` is returned in its stored form, exactly as before — the client decodes it, and
   * handing back plaintext would leave it decoding text that was never encoded.
   */
  async searchMessages(q: string, userId: string, conversationId?: string) {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];

    const rows = await this.prisma.messages.findMany({
      where: {
        deleted_at: null,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        conversations: { conversation_members: { some: { user_id: userId } } },
      },
      orderBy: { created_at: 'desc' },
      take: SEARCH_SCAN_LIMIT,
      select: {
        id: true, conversation_id: true, sender_id: true, type: true,
        ciphertext: true, created_at: true, edited_at: true, deleted_at: true,
      },
    });

    const hits: unknown[] = [];
    for (const m of rows) {
      if (!searchableText(m.ciphertext).toLowerCase().includes(needle)) continue;
      hits.push({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        type: m.type,
        ciphertext: decode(m.ciphertext),
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
      });
      if (hits.length >= SEARCH_RESULT_LIMIT) break;
    }
    return hits;
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
      select: {
        type: true, ciphertext: true, sender_id: true, conversation_id: true,
        // An attachment lives in a files row keyed to one message, so forwarding has to bring a
        // copy along — otherwise the forward arrives as an image or file with nothing in it.
        files: {
          select: {
            uploader_id: true, storage_key: true, file_name: true,
            mime_type: true, size_bytes: true, has_thumbnail: true, duration_secs: true,
          },
        },
      },
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
        // New rows pointing at the same storage_key: the object is shared, only the metadata is
        // duplicated, and files.message_id can only reference one message so the original's row
        // must stay where it is.
        files: original.files.length
          ? { createMany: { data: original.files.map((f) => ({ ...f })) } }
          : undefined,
      },
      select: { id: true },
    });

    await this.prisma.conversations.update({
      where: { id: targetConversationId },
      data: { updated_at: new Date() },
    });

    // Previously this returned only { id, conversationId }, which is not enough for the sender to
    // render the message, and nothing was broadcast — so the forward was invisible in the target
    // conversation until someone reloaded.
    const message = await this.shapeMessage(created.id);
    this.events.emit('message:new', message);
    return message;
  }

  /** Loads a message in the shape the client and the socket both expect. */
  private async shapeMessage(messageId: string) {
    const m = await this.prisma.messages.findUniqueOrThrow({
      where: { id: messageId },
      select: {
        id: true, conversation_id: true, sender_id: true, type: true, ciphertext: true,
        reply_to_message_id: true, forwarded_from_message_id: true,
        created_at: true, edited_at: true, deleted_at: true,
        files: true,
        users_messages_original_sender_idTousers: { select: { display_name: true } },
      },
    });
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      type: m.type,
      ciphertext: decode(m.ciphertext),
      replyToMessageId: m.reply_to_message_id,
      forwardedFromMessageId: m.forwarded_from_message_id,
      forwardedFromDisplayName: m.users_messages_original_sender_idTousers?.display_name ?? null,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      file: fileDto(m.files),
      reactions: [] as { emoji: string; userId: string; username: string; displayName: string }[],
    };
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
