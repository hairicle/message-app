import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccountStatusService } from '../../common/account-status.service';
import type { User } from '@messenger/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
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
    const user = await this.prisma.users.findUnique({
      where: { email },
      select: {
        id: true, email: true, username: true, display_name: true, role: true, status: true,
        password_hash: true, totp_secret: true, totp_enabled: true, avatar_url: true,
      },
    });

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

    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, username: true, display_name: true, role: true,
        status: true, totp_secret: true, totp_enabled: true, avatar_url: true,
      },
    });
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
    const row = await this.prisma.users.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, display_name: true, role: true, avatar_url: true },
    });
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
    // (user_id, device_name) carries only an index, not a unique constraint, so this stays a
    // find-then-create rather than an upsert — same shape, and same race window, as before.
    const existing = await this.prisma.user_devices.findFirst({
      where: { user_id: userId, device_name: deviceName },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.user_devices.update({
        where: { id: existing.id },
        data: { last_active_at: new Date() },
      });
      return existing.id;
    }
    const created = await this.prisma.user_devices.create({
      data: { user_id: userId, device_name: deviceName, last_active_at: new Date() },
      select: { id: true },
    });
    return created.id;
  }
}
