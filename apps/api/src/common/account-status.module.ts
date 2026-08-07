import { Module, Global } from '@nestjs/common';
import { AccountStatusService } from './account-status.service';

// Global: JwtAuthGuard is applied on every controller and the realtime gateway needs the same
// check, so the cache has to be one shared instance rather than one per importing module.
@Global()
@Module({
  providers: [AccountStatusService],
  exports: [AccountStatusService],
})
export class AccountStatusModule {}
