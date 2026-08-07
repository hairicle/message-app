import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get issuer() {
    return this.config.get<string>('TOTP_ISSUER') ?? 'InternalMessenger';
  }

  verifyCode(secret: string, email: string, code: string): boolean {
    const totp = new TOTP({ issuer: this.issuer, label: email, secret: Secret.fromBase32(secret) });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  async generateSetup(userId: string, email: string) {
    const secret = new Secret();
    const totp = new TOTP({ issuer: this.issuer, label: email, secret });
    const otpauthUrl = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.users.update({
      where: { id: userId },
      data: { totp_secret: secret.base32, totp_enabled: false },
    });

    return { secret: secret.base32, qrDataUrl, otpauthUrl };
  }

  async enable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { totp_secret: true, email: true },
    });
    if (!user?.totp_secret) throw new BadRequestException('TOTP setup not started');
    if (!this.verifyCode(user.totp_secret, user.email, code)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.prisma.users.update({ where: { id: userId }, data: { totp_enabled: true } });
  }

  async disable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { totp_secret: true, email: true },
    });
    if (!user?.totp_secret) throw new BadRequestException('2FA is not enabled');
    if (!this.verifyCode(user.totp_secret, user.email, code)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { totp_secret: null, totp_enabled: false },
    });
  }
}

// Standalone helper re-exported for auth.service completeTotpLogin usage
export function verifyTotpCode(secret: string, email: string, code: string): boolean {
  const issuer = process.env.TOTP_ISSUER ?? 'InternalMessenger';
  const totp = new TOTP({ issuer, label: email, secret: Secret.fromBase32(secret) });
  return totp.validate({ token: code, window: 1 }) !== null;
}
