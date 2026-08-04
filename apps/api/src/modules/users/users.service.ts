import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { randomUUID } from 'crypto';
import * as path from 'path';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private get storageBase(): string {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT') ?? '';
    return endpoint.replace(/\/storage\/v1\/s3\/?$/, '');
  }

  private get avatarBucket(): string {
    return this.config.get<string>('AVATAR_BUCKET') ?? 'avatars';
  }

  private supabaseHeaders(): Record<string, string> {
    const key = this.config.get<string>('SUPABASE_SERVICE_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async getProfile(userId: string) {
    const r = await this.db.query<{
      id: string; email: string; username: string; display_name: string;
      avatar_url: string | null; department: string | null; role: string;
    }>(
      `SELECT id, email, username, display_name, avatar_url, department, role
       FROM users WHERE id = $1`,
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
      `SELECT id, username, display_name, avatar_url, department
       FROM users WHERE id != $1 AND status = 'active'
       ORDER BY display_name`,
      [currentUserId],
    );
    return r.rows;
  }

  async listUsers() {
    const r = await this.db.query(
      `SELECT id, email, username, display_name, role, department, status, created_at
       FROM users ORDER BY created_at DESC`,
    );
    return { users: r.rows };
  }

  async createUser(data: { email: string; username: string; displayName: string; password: string; role?: string; department?: string | null }) {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(data.password, 12);
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, username, display_name, password_hash, role, department, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id`,
      [data.email, data.username, data.displayName, hash, data.role ?? 'staff', data.department ?? null],
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

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Avatar too large (max 5 MB)');
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const storageKey = `${userId}/${randomUUID()}${ext}`;
    const uploadUrl = `${this.storageBase}/storage/v1/object/${this.avatarBucket}/${storageKey}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { ...this.supabaseHeaders(), 'Content-Type': file.mimetype, 'x-upsert': 'true' },
      body: file.buffer,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => 'storage error');
      throw new BadRequestException(`Avatar upload failed: ${msg}`);
    }
    const avatarUrl = `${this.storageBase}/storage/v1/object/public/${this.avatarBucket}/${storageKey}`;
    await this.db.query('UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2', [avatarUrl, userId]);
    return this.getProfile(userId);
  }

  async getNotificationPrefs(userId: string) {
    const r = await this.db.query<{
      sound_enabled: boolean; desktop_enabled: boolean; email_enabled: boolean;
    }>(
      'SELECT sound_enabled, desktop_enabled, email_enabled FROM notification_preferences WHERE user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    return {
      soundEnabled: row?.sound_enabled ?? true,
      desktopEnabled: row?.desktop_enabled ?? true,
      emailEnabled: row?.email_enabled ?? false,
    };
  }

  async updateNotificationPrefs(
    userId: string,
    data: { soundEnabled?: boolean; desktopEnabled?: boolean; emailEnabled?: boolean },
  ) {
    await this.db.query(
      `INSERT INTO notification_preferences (user_id, sound_enabled, desktop_enabled, email_enabled, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         sound_enabled   = COALESCE($2, notification_preferences.sound_enabled),
         desktop_enabled = COALESCE($3, notification_preferences.desktop_enabled),
         email_enabled   = COALESCE($4, notification_preferences.email_enabled),
         updated_at      = now()`,
      [userId, data.soundEnabled ?? null, data.desktopEnabled ?? null, data.emailEnabled ?? null],
    );
    return this.getNotificationPrefs(userId);
  }

  async changePassword(userId: string, current: string, next: string) {
    const bcrypt = await import('bcryptjs');
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
