import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  async getStats() {
    const [totUsers, actUsers, totMsgs, msgs24h, totConvs] = await Promise.all([
      this.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users'),
      this.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users WHERE status = 'active'`),
      this.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM messages WHERE deleted_at IS NULL'),
      this.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM messages WHERE created_at > now() - interval '24h' AND deleted_at IS NULL`),
      this.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM conversations'),
    ]);
    return {
      stats: {
        totalUsers: totUsers.rows[0].count,
        activeUsers: actUsers.rows[0].count,
        totalMessages: totMsgs.rows[0].count,
        messagesLast24h: msgs24h.rows[0].count,
        totalConversations: totConvs.rows[0].count,
      },
    };
  }

  async disableUser(targetId: string) {
    await this.db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [targetId]);
    await this.authService.blockUser(targetId);
  }

  async enableUser(targetId: string) {
    await this.db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [targetId]);
    await this.authService.unblockUser(targetId);
  }

  async updateUser(targetId: string, fields: {
    displayName?: string; username?: string; email?: string;
    role?: string; department?: string | null; status?: string;
  }) {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (fields.displayName !== undefined) { updates.push(`display_name = $${idx++}`); values.push(fields.displayName); }
    if (fields.username !== undefined) { updates.push(`username = $${idx++}`); values.push(fields.username); }
    if (fields.email !== undefined) { updates.push(`email = $${idx++}`); values.push(fields.email); }
    if (fields.role !== undefined) { updates.push(`role = $${idx++}`); values.push(fields.role); }
    if ('department' in fields) { updates.push(`department = $${idx++}`); values.push(fields.department ?? null); }
    if (fields.status !== undefined) { updates.push(`status = $${idx++}::user_status`); values.push(fields.status); }

    if (updates.length > 0) {
      updates.push('updated_at = now()');
      values.push(targetId);
      await this.db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
        values,
      );
    }

    if (fields.status === 'disabled') await this.authService.blockUser(targetId);
    if (fields.status === 'active') await this.authService.unblockUser(targetId);

    return { ok: true };
  }

  async deleteUser(targetId: string) {
    await this.db.query('DELETE FROM users WHERE id = $1', [targetId]);
    return { ok: true };
  }

  async changeUserRole(targetId: string, role: string) {
    await this.db.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
  }

  async syncDepartmentTeams() {
    const depts = await this.db.query<{ name: string }>('SELECT name FROM departments');
    let synced = 0;

    for (const dept of depts.rows) {
      // Find or create a team for this department
      let teamId: string;
      const existing = await this.db.query<{ id: string }>(
        'SELECT id FROM teams WHERE name = $1 LIMIT 1',
        [dept.name],
      );
      if (existing.rows[0]) {
        teamId = existing.rows[0].id;
      } else {
        const created = await this.db.query<{ id: string }>(
          `INSERT INTO teams (name, description) VALUES ($1, $2) RETURNING id`,
          [dept.name, `${dept.name} department team`],
        );
        teamId = created.rows[0].id;
        const conv = await this.db.query<{ id: string }>(
          `INSERT INTO conversations (team_id, type, name) VALUES ($1, 'group', 'General') RETURNING id`,
          [teamId],
        );
        // Add a placeholder system user as owner to satisfy FK if needed
        // (conv created without a created_by for the sync path)
        void conv;
      }

      // Sync all active department users into the team
      const users = await this.db.query<{ id: string }>(
        `SELECT id FROM users WHERE department = $1 AND status = 'active'`,
        [dept.name],
      );
      for (const u of users.rows) {
        await this.db.query(
          'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [teamId, u.id, 'member'],
        );
        synced++;
      }
    }

    return { synced };
  }

  async listAuditLogs(limit = 100, action?: string) {
    const filterParams: unknown[] = [];
    const where = action ? 'WHERE al.action = $1' : '';
    if (action) filterParams.push(action);

    const [rows, countRes] = await Promise.all([
      this.db.query(
        `SELECT al.id, al.action, al.ip_address AS "ipAddress", al.metadata,
                al.created_at AS "createdAt", u.email AS "userEmail"
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${filterParams.length + 1}`,
        [...filterParams, limit],
      ),
      this.db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM audit_logs al ${where}`,
        filterParams,
      ),
    ]);

    return { logs: rows.rows, total: countRes.rows[0].count };
  }
}
