import { Injectable } from '@nestjs/common';
import { Prisma, user_status } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async getStats() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalUsers, activeUsers, totalMessages, messagesLast24h, totalConversations] =
      await Promise.all([
        this.prisma.users.count(),
        this.prisma.users.count({ where: { status: 'active' } }),
        this.prisma.messages.count({ where: { deleted_at: null } }),
        this.prisma.messages.count({ where: { deleted_at: null, created_at: { gt: since24h } } }),
        this.prisma.conversations.count(),
      ]);
    return { stats: { totalUsers, activeUsers, totalMessages, messagesLast24h, totalConversations } };
  }

  // updateMany rather than update throughout: the previous UPDATE … WHERE id = $1 was a no-op for
  // an unknown id, whereas Prisma's update throws P2025. Keeping the no-op preserves the
  // controllers' current responses.
  async disableUser(targetId: string) {
    await this.prisma.users.updateMany({ where: { id: targetId }, data: { status: 'disabled' } });
    await this.authService.blockUser(targetId);
  }

  async enableUser(targetId: string) {
    await this.prisma.users.updateMany({ where: { id: targetId }, data: { status: 'active' } });
    await this.authService.unblockUser(targetId);
  }

  async updateUser(targetId: string, fields: {
    displayName?: string; username?: string; email?: string;
    role?: string; department?: string | null; status?: string;
  }) {
    const data: Prisma.usersUpdateManyMutationInput = {};
    if (fields.displayName !== undefined) data.display_name = fields.displayName;
    if (fields.username !== undefined) data.username = fields.username;
    if (fields.email !== undefined) data.email = fields.email;
    if (fields.role !== undefined) data.role = fields.role;
    // 'in' rather than !== undefined so an explicit null clears the column, as before.
    if ('department' in fields) data.department = fields.department ?? null;
    if (fields.status !== undefined) data.status = fields.status as user_status;

    if (Object.keys(data).length > 0) {
      data.updated_at = new Date();
      await this.prisma.users.updateMany({ where: { id: targetId }, data });
    }

    if (fields.status === 'disabled') await this.authService.blockUser(targetId);
    if (fields.status === 'active') await this.authService.unblockUser(targetId);

    return { ok: true };
  }

  async deleteUser(targetId: string) {
    await this.prisma.users.deleteMany({ where: { id: targetId } });
    return { ok: true };
  }

  async changeUserRole(targetId: string, role: string) {
    await this.prisma.users.updateMany({ where: { id: targetId }, data: { role } });
  }

  async syncDepartmentTeams() {
    const departments = await this.prisma.departments.findMany({ select: { name: true } });
    let synced = 0;

    for (const dept of departments) {
      const existing = await this.prisma.teams.findFirst({
        where: { name: dept.name },
        select: { id: true },
      });

      let teamId: string;
      if (existing) {
        teamId = existing.id;
      } else {
        const team = await this.prisma.teams.create({
          data: { name: dept.name, description: `${dept.name} department team` },
          select: { id: true },
        });
        teamId = team.id;
        // Created without a created_by, matching the previous sync path.
        await this.prisma.conversations.create({
          data: { team_id: teamId, type: 'group', name: 'General' },
          select: { id: true },
        });
      }

      const users = await this.prisma.users.findMany({
        where: { department: dept.name, status: 'active' },
        select: { id: true },
      });

      for (const user of users) {
        // upsert with an empty update is the previous ON CONFLICT DO NOTHING.
        await this.prisma.team_members.upsert({
          where: { team_id_user_id: { team_id: teamId, user_id: user.id } },
          update: {},
          create: { team_id: teamId, user_id: user.id, role: 'member' },
        });
        synced++;
      }
    }

    return { synced };
  }

  async listAuditLogs(limit = 100, action?: string) {
    const where: Prisma.audit_logsWhereInput = action ? { action } : {};

    const [rows, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          id: true,
          action: true,
          ip_address: true,
          metadata: true,
          created_at: true,
          // LEFT JOIN: a log whose user has been deleted still appears, with a null email.
          users: { select: { email: true } },
        },
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    const logs = rows.map((l) => ({
      id: l.id,
      action: l.action,
      ipAddress: l.ip_address,
      metadata: l.metadata,
      createdAt: l.created_at,
      userEmail: l.users?.email ?? null,
    }));

    return { logs, total };
  }
}
