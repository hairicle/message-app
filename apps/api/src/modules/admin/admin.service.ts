import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  async disableUser(targetId: string) {
    await this.db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [targetId]);
    await this.authService.blockUser(targetId);
  }

  async enableUser(targetId: string) {
    await this.db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [targetId]);
    await this.authService.unblockUser(targetId);
  }

  async changeUserRole(targetId: string, role: string) {
    await this.db.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
  }

  async listAuditLogs(limit = 100) {
    const r = await this.db.query(
      `SELECT al.*, u.username FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }
}
