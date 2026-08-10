import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma, user_status } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';

/**
 * Roles the application understands.
 *
 * `role` is a plain string column with nothing behind it, so a typo in the admin form was stored
 * verbatim — and RolesGuard, which compares exactly, then matched nothing. The account silently
 * lost every privilege with no screen explaining why. Fifteen accounts already carry "Manager"
 * from before this check existed.
 *
 * `manager` is included because those accounts exist and mean something to the people using them,
 * even though only `admin` currently grants anything.
 */
const ROLES = ['admin', 'manager', 'staff'] as const;

/** Mirrors the user_status enum, so an unknown value is refused before Postgres has to refuse it. */
const STATUSES = ['active', 'disabled'] as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Accepts a known role in any capitalisation and stores it lowercased.
   *
   * Case matters to RolesGuard but not to the person typing it, and "Manager" already in the
   * database does not match the lowercase comparison TeamWorkspace makes against it.
   */
  private normaliseRole(role: string): string {
    const found = ROLES.find((r) => r === role.trim().toLowerCase());
    if (!found) {
      throw new BadRequestException(`Unknown role "${role}". Use one of: ${ROLES.join(', ')}`);
    }
    return found;
  }

  private normaliseStatus(status: string): user_status {
    const found = STATUSES.find((s) => s === status.trim().toLowerCase());
    if (!found) {
      throw new BadRequestException(`Unknown status "${status}". Use one of: ${STATUSES.join(', ')}`);
    }
    return found as user_status;
  }

  /**
   * Record an administrative action.
   *
   * Audit writing was lost in the NestJS refactor: the table and the screen that reads it both
   * survived, but nothing has written to it since, so the log showed only logins from before the
   * rewrite while disabling accounts and changing roles left no trace at all.
   *
   * Never allowed to fail the action it describes — refusing to disable an account because its
   * audit row could not be written would be the wrong way round.
   */
  private async record(actorId: string | null, action: string, targetId: string | null, metadata?: Record<string, unknown>) {
    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action,
          target_type: targetId ? 'user' : null,
          target_id: targetId,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not write audit entry for ${action}: ${(err as Error).message}`);
    }
  }

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
  async disableUser(targetId: string, actorId: string | null = null) {
    await this.prisma.users.updateMany({ where: { id: targetId }, data: { status: 'disabled' } });
    await this.authService.blockUser(targetId);
    await this.record(actorId, 'admin.user.disabled', targetId);
  }

  async enableUser(targetId: string, actorId: string | null = null) {
    await this.prisma.users.updateMany({ where: { id: targetId }, data: { status: 'active' } });
    await this.authService.unblockUser(targetId);
    await this.record(actorId, 'admin.user.enabled', targetId);
  }

  async updateUser(targetId: string, fields: {
    displayName?: string; username?: string; email?: string;
    role?: string; department?: string | null; status?: string;
  }, actorId: string | null = null) {
    const data: Prisma.usersUpdateManyMutationInput = {};
    if (fields.displayName !== undefined) data.display_name = fields.displayName;
    if (fields.username !== undefined) data.username = fields.username;
    if (fields.email !== undefined) data.email = fields.email;
    // Validated before anything is written, so a bad role does not leave the other fields half
    // applied — and so it answers 400 rather than the 500 an invalid enum produced.
    if (fields.role !== undefined) data.role = this.normaliseRole(fields.role);
    // 'in' rather than !== undefined so an explicit null clears the column, as before.
    if ('department' in fields) data.department = fields.department ?? null;
    if (fields.status !== undefined) data.status = this.normaliseStatus(fields.status);

    if (Object.keys(data).length > 0) {
      data.updated_at = new Date();
      await this.prisma.users.updateMany({ where: { id: targetId }, data });
      // The changed field names, not their values: an audit trail should say what was touched
      // without becoming a second copy of the data.
      await this.record(actorId, 'admin.user.updated', targetId, { fields: Object.keys(fields) });
    }

    if (fields.status === 'disabled') await this.authService.blockUser(targetId);
    if (fields.status === 'active') await this.authService.unblockUser(targetId);

    return { ok: true };
  }

  async deleteUser(targetId: string, actorId: string | null = null) {
    // Read first: once the row is gone there is nothing left to say who was removed, and an audit
    // entry naming only a uuid is of little use to whoever reads it later.
    const target = await this.prisma.users.findUnique({
      where: { id: targetId },
      select: { email: true, username: true },
    });
    await this.prisma.users.deleteMany({ where: { id: targetId } });
    await this.record(actorId, 'admin.user.deleted', targetId, {
      email: target?.email,
      username: target?.username,
    });
    return { ok: true };
  }

  async changeUserRole(targetId: string, role: string, actorId: string | null = null) {
    const normalised = this.normaliseRole(role);
    const before = await this.prisma.users.findUnique({ where: { id: targetId }, select: { role: true } });
    await this.prisma.users.updateMany({ where: { id: targetId }, data: { role: normalised } });
    // Both ends recorded: a role change is the one admin action where what it was matters as much
    // as what it became.
    await this.record(actorId, 'admin.user.role_changed', targetId, { from: before?.role, to: normalised });
  }

  async syncDepartmentTeams(actorId: string | null = null) {
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

    await this.record(actorId, 'admin.departments.synced', null, { synced });
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
