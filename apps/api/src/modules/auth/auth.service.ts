import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { AccountStatusService } from '../../common/account-status.service';
import type { User } from '@messenger/shared';

interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  password_hash: string | null;
  ldap_dn: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  avatar_url: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly accountStatus: AccountStatusService,
  ) {}

  private issueFullToken(user: { id: string; email: string; role: string }, deviceId: string) {
    return this.jwt.sign(
      { id: user.id, email: user.email, role: user.role, deviceId },
      { expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '1h' },
    );
  }

  private issueTotpPendingToken(userId: string) {
    return this.jwt.sign({ sub: userId, scope: 'totp_pending', jti: randomUUID() }, { expiresIn: '5m' });
  }

  async login(email: string, password: string, deviceName = 'default') {
    const result = await this.db.query<UserRow>(
      `SELECT id, email, username, display_name, role, status, password_hash,
              ldap_dn, totp_secret, totp_enabled, avatar_url
       FROM users WHERE email = $1`,
      [email],
    );
    const user = result.rows[0];

    if (!user || !user.password_hash) throw new UnauthorizedException('Invalid email or password');
    if (user.status !== 'active') throw new ForbiddenException('Account is disabled');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    if (user.totp_enabled && user.totp_secret) {
      return { requiresTotp: true as const, totpToken: this.issueTotpPendingToken(user.id) };
    }

    const deviceId = await this.getOrCreateDevice(user.id, deviceName);
    const token = this.issueFullToken({ id: user.id, email: user.email, role: user.role }, deviceId);

    return {
      requiresTotp: false as const,
      token,
      deviceId,
      user: { id: user.id, email: user.email, username: user.username, displayName: user.display_name, role: user.role, avatarUrl: user.avatar_url },
    };
  }

  async completeTotpLogin(totpToken: string, code: string, deviceName = 'default') {
    let payload: { sub: string; scope: string; jti: string };
    try {
      payload = this.jwt.verify(totpToken) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired TOTP session token');
    }
    if (payload.scope !== 'totp_pending') throw new UnauthorizedException('Invalid token scope');

    const replayKey = `totp:used:${payload.jti}`;
    const alreadyUsed = await this.redis.get(replayKey);
    if (alreadyUsed) throw new UnauthorizedException('TOTP session has already been used');

    const result = await this.db.query<{
      id: string; email: string; username: string; display_name: string;
      role: string; status: string; totp_secret: string | null; totp_enabled: boolean;
      avatar_url: string | null;
    }>(
      'SELECT id, email, username, display_name, role, status, totp_secret, totp_enabled, avatar_url FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') throw new UnauthorizedException('Account not found or disabled');
    if (!user.totp_enabled || !user.totp_secret) throw new BadRequestException('2FA is not enabled on this account');

    const { verifyTotpCode } = await import('./totp.service');
    if (!verifyTotpCode(user.totp_secret, user.email, code)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    const deviceId = await this.getOrCreateDevice(user.id, deviceName);
    const token = this.issueFullToken({ id: user.id, email: user.email, role: user.role }, deviceId);

    // Consume the TOTP session so it cannot be replayed
    await this.redis.set(replayKey, '1', 'EX', 300);

    return {
      token,
      deviceId,
      user: { id: user.id, email: user.email, username: user.username, displayName: user.display_name, role: user.role, avatarUrl: user.avatar_url },
    };
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await this.db.query<{
      id: string; email: string; username: string; display_name: string; role: string; avatar_url: string | null;
    }>(
      'SELECT id, email, username, display_name, role, avatar_url FROM users WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      avatarUrl: row.avatar_url,
    };
  }

  async blockUser(userId: string): Promise<void> {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '1h';
    const ttl = this.jwtExpiryToSeconds(expiresIn) + 60;
    await this.redis.set(`disabled:user:${userId}`, '1', 'EX', ttl);
    // Drops any sockets the user still has open, on top of clearing the cached decision.
    this.accountStatus.announceDisabled(userId);
  }

  async unblockUser(userId: string): Promise<void> {
    await this.redis.del(`disabled:user:${userId}`);
    this.accountStatus.evict(userId);
  }

  private jwtExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 3600;
    const n = Number(match[1]);
    switch (match[2]) {
      case 's': return n;
      case 'm': return n * 60;
      case 'h': return n * 3600;
      case 'd': return n * 86400;
      default: return 3600;
    }
  }

  private async getOrCreateDevice(userId: string, deviceName: string): Promise<string> {
    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM user_devices WHERE user_id = $1 AND device_name = $2',
      [userId, deviceName],
    );
    if (existing.rows[0]) {
      await this.db.query('UPDATE user_devices SET last_active_at = now() WHERE id = $1', [existing.rows[0].id]);
      return existing.rows[0].id;
    }
    const created = await this.db.query<{ id: string }>(
      'INSERT INTO user_devices (user_id, device_name, last_active_at) VALUES ($1, $2, now()) RETURNING id',
      [userId, deviceName],
    );
    return created.rows[0].id;
  }
}
