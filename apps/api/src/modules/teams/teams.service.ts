import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** ciphertext is a bytea column; the old SQL decoded it with convert_from(…, 'UTF8'). */
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

const MANAGER_ROLES = ['owner', 'admin'];

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async listTeams(userId: string) {
    const rows = await this.prisma.teams.findMany({
      where: { team_members: { some: { user_id: userId } } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        created_at: true,
        _count: { select: { team_members: true } },
        team_members: { where: { user_id: userId }, select: { role: true }, take: 1 },
      },
    });

    // Shape kept identical to the previous JOIN + scalar-subquery query.
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      created_at: t.created_at,
      myRole: t.team_members[0]?.role ?? null,
      memberCount: t._count.team_members,
    }));
  }

  async createTeam(userId: string, data: { name: string; description?: string }) {
    // Four writes that must all land together — the previous version issued them separately, so
    // a failure part-way left a team with no owner or no General conversation.
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.teams.create({
        data: { name: data.name, description: data.description ?? null, created_by: userId },
        select: { id: true },
      });
      await tx.team_members.create({ data: { team_id: team.id, user_id: userId, role: 'owner' } });

      const conversation = await tx.conversations.create({
        data: { team_id: team.id, type: 'group', name: 'General', created_by: userId },
        select: { id: true },
      });
      await tx.conversation_members.create({
        data: { conversation_id: conversation.id, user_id: userId, role: 'owner' },
      });

      return { id: team.id };
    });
  }

  private async assertManager(teamId: string, requesterId: string) {
    const membership = await this.prisma.team_members.findUnique({
      where: { team_id_user_id: { team_id: teamId, user_id: requesterId } },
      select: { role: true },
    });
    if (!membership || !MANAGER_ROLES.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  async addMember(teamId: string, requesterId: string, targetUserId: string, role = 'member') {
    await this.assertManager(teamId, requesterId);

    // upsert with an empty update is the ON CONFLICT DO NOTHING the previous SQL used.
    await this.prisma.team_members.upsert({
      where: { team_id_user_id: { team_id: teamId, user_id: targetUserId } },
      update: {},
      create: { team_id: teamId, user_id: targetUserId, role },
    });

    const conversationId = await this.getTeamConversationId(teamId);
    if (conversationId) {
      await this.prisma.conversation_members.upsert({
        where: { conversation_id_user_id: { conversation_id: conversationId, user_id: targetUserId } },
        update: {},
        create: { conversation_id: conversationId, user_id: targetUserId, role: role as never },
      });
    }
  }

  async removeMember(teamId: string, requesterId: string, targetUserId: string) {
    await this.assertManager(teamId, requesterId);
    await this.prisma.team_members.deleteMany({
      where: { team_id: teamId, user_id: targetUserId },
    });
  }

  async getMembers(teamId: string) {
    const rows = await this.prisma.team_members.findMany({
      where: { team_id: teamId },
      orderBy: { joined_at: 'asc' },
      select: {
        role: true,
        joined_at: true,
        users: { select: { id: true, display_name: true, username: true, avatar_url: true } },
      },
    });

    return rows.map((m) => ({
      userId: m.users.id,
      displayName: m.users.display_name,
      username: m.users.username,
      avatarUrl: m.users.avatar_url,
      role: m.role,
      joinedAt: m.joined_at,
    }));
  }

  private async getTeamConversationId(teamId: string): Promise<string | null> {
    const conversation = await this.prisma.conversations.findFirst({
      where: { team_id: teamId },
      orderBy: { created_at: 'asc' },
      select: { id: true },
    });
    return conversation?.id ?? null;
  }

  private async assertTeamMember(teamId: string, userId: string) {
    const membership = await this.prisma.team_members.findUnique({
      where: { team_id_user_id: { team_id: teamId, user_id: userId } },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this team');
  }

  async getMessages(teamId: string, userId: string) {
    await this.assertTeamMember(teamId, userId);

    const conversationId = await this.getTeamConversationId(teamId);
    if (!conversationId) return { conversationId: null, messages: [] };

    const rows = await this.prisma.messages.findMany({
      // sender_id is nullable, and the previous query INNER JOINed users — so system messages
      // with no sender were excluded. Keep excluding them rather than rendering a blank author.
      where: { conversation_id: conversationId, deleted_at: null, sender_id: { not: null } },
      orderBy: { created_at: 'asc' },
      take: 100,
      select: {
        id: true,
        sender_id: true,
        ciphertext: true,
        created_at: true,
        users_messages_sender_idTousers: { select: { display_name: true } },
        files: true,
      },
    });

    return {
      conversationId,
      messages: rows.map((m) => ({
        id: m.id,
        userId: m.sender_id,
        displayName: m.users_messages_sender_idTousers?.display_name ?? '',
        content: decode(m.ciphertext),
        createdAt: m.created_at,
        // The old LEFT JOIN + to_json(f) yielded a single file row or null.
        file: m.files[0] ?? null,
      })),
    };
  }

  async sendMessage(teamId: string, userId: string, content: string) {
    await this.assertTeamMember(teamId, userId);

    const conversationId = await this.getTeamConversationId(teamId);
    if (!conversationId) throw new NotFoundException('Team conversation not found');

    const [message, user] = await this.prisma.$transaction([
      this.prisma.messages.create({
        data: {
          conversation_id: conversationId,
          sender_id: userId,
          type: 'text',
          ciphertext: Buffer.from(content, 'utf8'),
        },
        select: { id: true, created_at: true },
      }),
      this.prisma.users.findUnique({ where: { id: userId }, select: { display_name: true } }),
    ]);

    await this.prisma.conversations.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    });

    return {
      id: message.id,
      userId,
      displayName: user?.display_name ?? '',
      content,
      createdAt: message.created_at,
    };
  }

  async getPinned(teamId: string) {
    const conversationId = await this.getTeamConversationId(teamId);
    if (!conversationId) return [];

    const rows = await this.prisma.pinned_messages.findMany({
      // pinned_by is nullable and was INNER JOINed, so pins by a deleted user were dropped.
      where: { conversation_id: conversationId, pinned_by: { not: null } },
      orderBy: { pinned_at: 'desc' },
      select: {
        message_id: true,
        pinned_at: true,
        messages: { select: { ciphertext: true } },
        users: { select: { display_name: true } },
      },
    });

    return rows.map((p) => ({
      id: p.message_id,
      type: 'link',
      title: decode(p.messages.ciphertext),
      url: '',
      addedBy: p.users?.display_name ?? '',
      addedAt: p.pinned_at,
    }));
  }
}
