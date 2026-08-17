import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  deviceName: z.string().optional(),
});

const totpCodeSchema = z.object({ code: z.string().length(6) });

/** Opaque and high-entropy; only its presence and shape are checked here. */
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async login(@Body() body: unknown) {
    const { email, password, deviceName } = loginSchema.parse(body);
    return this.authService.login(email, password, deviceName);
  }

  @Post('login/totp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async completeTotpLogin(@Body() body: unknown) {
    const { totpToken, code, deviceName } = z
      .object({ totpToken: z.string(), code: z.string().length(6), deviceName: z.string().optional() })
      .parse(body);
    return this.authService.completeTotpLogin(totpToken, code, deviceName);
  }

  /**
   * Exchange a refresh token for a fresh access token.
   *
   * Not behind JwtAuthGuard — the whole point is to be callable once the access token has expired,
   * which is when the guard would refuse. The refresh token is the credential here.
   *
   * Throttled, because it is unauthenticated and takes a secret: a budget per address stops it
   * being used to test tokens at speed. Looser than sign-in, since a client on a poor connection
   * may legitimately retry.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 900_000 } })
  async refresh(@Body() body: unknown) {
    const { refreshToken } = refreshSchema.parse(body);
    return this.authService.refresh(refreshToken);
  }

  /**
   * End this device's session.
   *
   * Answers the same way whether or not the token matched, and is deliberately not guarded: signing
   * out with an already-expired access token has to work, or a stale session could never be ended
   * from the client that holds it.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown) {
    const { refreshToken } = refreshSchema.parse(body);
    await this.authService.signOut(refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthPayload) {
    const profile = await this.authService.getUserById(user.id);
    if (!profile) throw new NotFoundException('User not found');
    return { user: profile };
  }

  @Post('totp/setup')
  @UseGuards(JwtAuthGuard)
  async totpSetup(@CurrentUser() user: AuthPayload) {
    const profile = await this.authService.getUserById(user.id);
    if (!profile) throw new NotFoundException('User not found');
    return this.totpService.generateSetup(user.id, profile.email);
  }

  @Post('totp/enable')
  @UseGuards(JwtAuthGuard)
  async totpEnable(@CurrentUser() user: AuthPayload, @Body() body: unknown) {
    const { code } = totpCodeSchema.parse(body);
    await this.totpService.enable(user.id, code);
    return { totpEnabled: true };
  }

  @Delete('totp')
  @UseGuards(JwtAuthGuard)
  async totpDisable(@CurrentUser() user: AuthPayload, @Body() body: unknown) {
    const { code } = totpCodeSchema.parse(body);
    await this.totpService.disable(user.id, code);
    return { totpEnabled: false };
  }
}
