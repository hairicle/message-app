import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, conversation_type, member_role, message_type } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { PrismaService } from '../../database/prisma.service';
import { AvatarStorageService } from '../../common/avatar-storage.service';
import { AvatarUrlService } from '../../common/avatar-url.service';

/** ciphertext is bytea; the SQL form decoded it with convert_from(…, 'UTF8'). */
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

/** files.size_bytes is bigint, which does not survive JSON serialisation as-is. */
const fileDto = (f: {
  id: string; file_name: string; mime_type: string; size_bytes: bigint;
  has_thumbnail: boolean; duration_secs: number | null; created_at: Date;
}) => ({
  id: f.id,
  fileName: f.file_name,
  mimeType: f.mime_type,
  sizeBytes: Number(f.size_bytes),
  hasThumbnail: f.has_thumbnail,
  durationSecs: f.duration_secs,
  createdAt: f.created_at,
});

@Injectable()
export class ConversationsService {
  /**
   * Emits 'conversation:created' with the members' ids.
   *
   * Sockets join their conversation rooms once, at connect. Anyone already online when a
   * conversation is created therefore never joined its room, and received nothing from it until
   * they reloaded — so the realtime layer has to be told the moment one appears.
   */
  readonly events = new EventEmitter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly avatarStorage: AvatarStorageService,
    private readonly avatars: AvatarUrlService,
  ) {}

  async assertMember(conversationId: string, userId: string) {
    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this conversation');
  }

  /**
   * Sets a group's picture.
   *
   * The role check lives here rather than in the UI: hiding the camera overlay from a plain
   * member stops them clicking it, not from posting the request themselves. Direct conversations
   * are rejected outright — their avatar is the other person's, so writing one would produce a
   * picture nothing reads back.
   */
  async updateAvatar(conversationId: string, userId: string, file: Express.Multer.File) {
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { type: true, avatar_url: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type === 'direct') {
      throw new ForbiddenException('A direct conversation has no picture of its own');
    }

    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      select: { role: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this conversation');
    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can change the group picture');
    }

    const storageKey = await this.avatarStorage.upload(`conversation/${conversationId}`, file);
    const updated = await this.prisma.conversations.update({
      where: { id: conversationId },
      data: { avatar_url: storageKey, updated_at: new Date() },
      select: { id: true, avatar_url: true },
    });
    this.avatars.invalidate(conversation.avatar_url);
    return updated;
  }

  /** The caller's role, or null if they are not in the conversation. */
  private async roleOf(conversationId: string, userId: string): Promise<member_role | null> {
    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  /**
   * Assert the caller may administer this group.
   *
   * Direct conversations are rejected outright rather than checked: they have no name to change
   * and no membership to manage, so every one of these operations is meaningless there.
   */
  private async assertGroupAdmin(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type === 'direct') {
      throw new ForbiddenException('A direct conversation has no settings to change');
    }

    const role = await this.roleOf(conversationId, userId);
    if (!role) throw new ForbiddenException('Not a member of this conversation');
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can change this');
    }
  }

  /** Rename a group, or change what it says it is for. */
  async updateDetails(conversationId: string, userId: string, data: { name?: string; description?: string }) {
    await this.assertGroupAdmin(conversationId, userId);

    const patch: Prisma.conversationsUpdateInput = { updated_at: new Date() };
    if (data.name !== undefined) {
      const name = data.name.trim();
      // A group with a blank name renders as an empty header, so it is refused rather than
      // silently stored.
      if (!name) throw new BadRequestException('A group needs a name');
      patch.name = name;
    }
    if (data.description !== undefined) {
      patch.description = data.description.trim() || null;
    }

    await this.prisma.conversations.update({ where: { id: conversationId }, data: patch });
    return this.getConversation(conversationId, userId);
  }

  /** Add people to a group. Already-members are left as they are rather than treated as an error. */
  async addMembers(conversationId: string, userId: string, userIds: string[]) {
    await this.assertGroupAdmin(conversationId, userId);
    const toAdd = [...new Set(userIds)].filter(Boolean);
    if (toAdd.length === 0) throw new BadRequestException('No one to add');

    const existing = await this.prisma.users.findMany({
      where: { id: { in: toAdd }, status: 'active' },
      select: { id: true },
    });
    if (existing.length === 0) throw new BadRequestException('No such active users');

    await this.prisma.conversation_members.createMany({
      data: existing.map((u) => ({ conversation_id: conversationId, user_id: u.id, role: 'member' as member_role })),
      skipDuplicates: true,
    });

    this.events.emit('conversation:members-added', {
      conversationId,
      memberIds: existing.map((u) => u.id),
    });
    return this.getConversation(conversationId, userId);
  }

  /**
   * Remove someone, or leave.
   *
   * The same operation either way — the difference is only whether you are the subject — so
   * anyone may remove themselves and an owner or admin may remove anyone else.
   *
   * An owner leaving hands ownership to the longest-standing member rather than being refused.
   * Refusing would trap them, and leaving the group ownerless would make it unadministrable by
   * anyone.
   */
  async removeMember(conversationId: string, actorId: string, targetId: string) {
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type === 'direct') {
      throw new ForbiddenException('A direct conversation has no members to remove');
    }

    const actorRole = await this.roleOf(conversationId, actorId);
    if (!actorRole) throw new ForbiddenException('Not a member of this conversation');

    const leaving = actorId === targetId;
    if (!leaving && actorRole !== 'owner' && actorRole !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can remove someone');
    }

    const targetRole = await this.roleOf(conversationId, targetId);
    if (!targetRole) throw new NotFoundException('That person is not in this conversation');
    // Otherwise an admin could remove the owner and take the group.
    if (!leaving && targetRole === 'owner') {
      throw new ForbiddenException('The owner cannot be removed');
    }

    await this.prisma.conversation_members.delete({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: targetId } },
    });

    if (targetRole === 'owner') {
      const successor = await this.prisma.conversation_members.findFirst({
        where: { conversation_id: conversationId },
        orderBy: [{ joined_at: 'asc' }, { user_id: 'asc' }],
        select: { user_id: true },
      });
      if (successor) {
        await this.prisma.conversation_members.update({
          where: { conversation_id_user_id: { conversation_id: conversationId, user_id: successor.user_id } },
          data: { role: 'owner' },
        });
      }
    }

    this.events.emit('conversation:member-removed', { conversationId, memberId: targetId });
    return { conversationId, removed: targetId };
  }

  /**
   * Kept as a raw query deliberately.
   *
   * The unread count compares each message against *that member's* last-read message timestamp,
   * so the cutoff differs per conversation. Prisma's builder cannot express a correlated subquery
   * like that, and doing it per conversation would turn one round-trip into one per row. This is
   * still Prisma — same client, same pool, parameterised — just its raw escape hatch.
   */
  async listConversations(userId: string) {
    return this.prisma.$queryRaw<unknown[]>`
      SELECT c.*,
        (cm.muted_until IS NOT NULL AND cm.muted_until > now()) AS is_muted,
        COALESCE(unread.count, 0)::int AS unread_count,
        lm.msg AS last_message,
        mem.members AS members
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ${userId}::uuid
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS count
        FROM messages m
        LEFT JOIN messages lrm ON lrm.id = cm.last_read_message_id
        WHERE m.conversation_id = c.id
          AND m.sender_id != ${userId}::uuid
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
        FROM (
          SELECT * FROM conversation_members
          WHERE conversation_id = c.id
          ORDER BY joined_at ASC, user_id ASC
        ) cm2
        JOIN users u ON u.id = cm2.user_id
      ) mem ON true
      ORDER BY c.updated_at DESC`;
  }

  async getConversation(id: string, userId: string) {
    await this.assertMember(id, userId);
    const conversation = await this.prisma.conversations.findUnique({
      where: { id },
      include: {
        conversation_members: {
          // The json_agg this replaced had no ORDER BY, so member order varied between calls.
          // Ordering explicitly makes the payload stable; user_id breaks ties for members added
          // in the same statement, which share a joined_at.
          orderBy: [{ joined_at: 'asc' }, { user_id: 'asc' }],
          select: {
            role: true,
            joined_at: true,
            users: { select: { id: true, username: true, display_name: true, avatar_url: true } },
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const { conversation_members, ...rest } = conversation;
    return {
      ...rest,
      // Same snake_case member shape the json_build_object produced — the web app reads
      // display_name and avatar_url straight off these objects.
      members: conversation_members.map((m) => ({
        user_id: m.users.id,
        username: m.users.username,
        display_name: m.users.display_name,
        avatar_url: m.users.avatar_url,
        role: m.role,
        joined_at: m.joined_at,
      })),
    };
  }

  async createConversation(userId: string, body: {
    type: string; name?: string; description?: string; memberIds?: string[]; teamId?: string;
  }) {
    const memberIds = [...new Set([userId, ...(body.memberIds ?? [])])];

    // One statement rather than the previous per-member loop, so a failure part-way cannot leave
    // a conversation with only some of its members.
    const conversation = await this.prisma.conversations.create({
      data: {
        type: body.type as conversation_type,
        name: body.name ?? null,
        description: body.description ?? null,
        team_id: body.teamId ?? null,
        created_by: userId,
        conversation_members: {
          createMany: {
            data: memberIds.map((id) => ({
              user_id: id,
              role: (id === userId ? 'owner' : 'member') as member_role,
            })),
            skipDuplicates: true,
          },
        },
      },
      select: { id: true },
    });

    this.events.emit('conversation:created', { conversationId: conversation.id, memberIds });
    return this.getConversation(conversation.id, userId);
  }

  async listPinnedMessages(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const rows = await this.prisma.pinned_messages.findMany({
      // Both users joins were INNER, so pins by a deleted user, or of a senderless message,
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

  async getMedia(conversationId: string, userId: string) {
    return this.getAttachments(conversationId, userId, ['image', 'video']);
  }

  async getAttachments(conversationId: string, userId: string, types: string[]) {
    await this.assertMember(conversationId, userId);

    // Queried from the files side: the previous INNER JOIN files yielded one row per file, so a
    // message carrying two attachments appeared twice.
    const rows = await this.prisma.files.findMany({
      where: {
        messages: {
          conversation_id: conversationId,
          type: { in: types as message_type[] },
          deleted_at: null,
        },
      },
      orderBy: { messages: { created_at: 'desc' } },
      select: {
        id: true, file_name: true, mime_type: true, size_bytes: true,
        has_thumbnail: true, duration_secs: true, created_at: true,
        messages: { select: { id: true, type: true, created_at: true, sender_id: true } },
      },
    });

    return rows.map(({ messages, ...file }) => ({
      messageId: messages!.id,
      type: messages!.type,
      createdAt: messages!.created_at,
      senderId: messages!.sender_id,
      file: fileDto(file),
    }));
  }

  async pinMessage(conversationId: string, messageId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    await this.prisma.pinned_messages.upsert({
      where: { conversation_id_message_id: { conversation_id: conversationId, message_id: messageId } },
      update: {},
      create: { conversation_id: conversationId, message_id: messageId, pinned_by: userId },
    });
  }

  async unpinMessage(conversationId: string, messageId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    await this.prisma.pinned_messages.deleteMany({
      where: { conversation_id: conversationId, message_id: messageId },
    });
  }

  async muteConversation(conversationId: string, userId: string, muted: boolean) {
    // The SQL used now() + interval '100 years' as a stand-in for "indefinitely".
    const mutedUntil = muted ? new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000) : null;
    await this.prisma.conversation_members.updateMany({
      where: { conversation_id: conversationId, user_id: userId },
      data: { muted_until: mutedUntil },
    });
  }
}

// Referenced by the media endpoint's type filter.
export type { Prisma };
