import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

/** An FCM registration token: opaque, long, and not worth parsing beyond its shape. */
const tokenSchema = z.object({ token: z.string().min(20).max(4096) });

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  /**
   * Say where this device can be reached.
   *
   * The device is taken from the caller's own token, never from the body — otherwise one session
   * could point another device's notifications at itself.
   */
  @Post('token')
  async register(@CurrentUser() user: AuthPayload, @Body() body: unknown) {
    const { token } = tokenSchema.parse(body);
    await this.push.registerToken(user.deviceId, token);
    return { ok: true };
  }

  /** Stop notifying this device. Called on sign-out, before the session itself is ended. */
  @Delete('token')
  async unregister(@CurrentUser() user: AuthPayload) {
    await this.push.clearToken(user.deviceId);
    return { ok: true };
  }
}
