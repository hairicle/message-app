import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class HealthController {
  /**
   * Exempt from rate limiting. The platform polls this to decide whether the service is alive, and
   * every poll arrives from the same address — throttling it would eventually answer 429, which
   * reads as unhealthy and takes the service out of rotation for being up.
   */
  @SkipThrottle()
  @Get('health')
  check() {
    return { status: 'ok' };
  }
}
