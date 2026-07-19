import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async getProfile(userId: string) {
    const r = await this.db.query<{
      id: string; email: string; username: string; display_name: string;
      avatar_url: string | null; department: string | null; role: string;
    }>(
      `SELECT u.id, u.email, u.username, u.display_name, u.avatar_url, d.name AS department, u.role
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id, email: row.email, username: row.username,
      displayName: row.display_name, avatarUrl: row.avatar_url,
      department: row.department, role: row.role,
    };
  }

  async listDirectory(currentUserId: string) {
    const r = await this.db.query<{
      id: string; username: string; display_name: string; avatar_url: string | null; department: string | null;
    }>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id != $1 AND u.status = 'active'
       ORDER BY u.display_name`,
      [currentUserId],
    );
    return r.rows;
  }

  async listUsers() {
    const r = await this.db.query<{
      id: string; email: string; username: string; display_name: string; role: string; status: string;
    }>(
      `SELECT id, email, username, display_name, role, status FROM users ORDER BY created_at DESC`,
    );
    return r.rows;
  }

  async createUser(data: { email: string; username: string; displayName: string; password: string; role?: string }) {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(data.password, 12);
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, username, display_name, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [data.email, data.username, data.displayName, hash, data.role ?? 'user'],
    );
    return { id: r.rows[0].id };
  }

  async updateProfile(userId: string, data: { displayName?: string; username?: string }) {
    await this.db.query(
      `UPDATE users SET
         display_name = COALESCE($1, display_name),
         username = COALESCE($2, username),
         updated_at = now()
       WHERE id = $3`,
      [data.displayName ?? null, data.username ?? null, userId],
    );
  }

  async changePassword(userId: string, current: string, next: string) {
    const bcrypt = await import('bcrypt');
    const r = await this.db.query<{ password_hash: string | null }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    const hash = r.rows[0]?.password_hash;
    if (!hash || !(await bcrypt.compare(current, hash))) {
      throw new Error('Current password is incorrect');
    }
    const newHash = await bcrypt.hash(next, 12);
    await this.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
  }
}
