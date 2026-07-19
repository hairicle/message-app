import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TotpService {
  constructor(
    private readonly db: DatabaseService,
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

    await this.db.query(
      'UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2',
      [secret.base32, userId],
    );

    return { secret: secret.base32, qrDataUrl, otpauthUrl };
  }

  async enable(userId: string, code: string): Promise<void> {
    const result = await this.db.query<{ totp_secret: string | null; email: string }>(
      'SELECT totp_secret, email FROM users WHERE id = $1',
      [userId],
    );
    const user = result.rows[0];
    if (!user?.totp_secret) throw new BadRequestException('TOTP setup not started');
    if (!this.verifyCode(user.totp_secret, user.email, code)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [userId]);
  }

  async disable(userId: string, code: string): Promise<void> {
    const result = await this.db.query<{ totp_secret: string | null; email: string }>(
      'SELECT totp_secret, email FROM users WHERE id = $1',
      [userId],
    );
    const user = result.rows[0];
    if (!user?.totp_secret) throw new BadRequestException('2FA is not enabled');
    if (!this.verifyCode(user.totp_secret, user.email, code)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.db.query(
      'UPDATE users SET totp_secret = null, totp_enabled = false WHERE id = $1',
      [userId],
    );
  }
}

// Standalone helper re-exported for auth.service completeTotpLogin usage
export function verifyTotpCode(secret: string, email: string, code: string): boolean {
  const issuer = process.env.TOTP_ISSUER ?? 'InternalMessenger';
  const totp = new TOTP({ issuer, label: email, secret: Secret.fromBase32(secret) });
  return totp.validate({ token: code, window: 1 }) !== null;
}
