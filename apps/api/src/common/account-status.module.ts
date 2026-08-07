import { Module, Global } from '@nestjs/common';
import { AccountStatusService } from './account-status.service';
import { AvatarUrlService } from './avatar-url.service';

// Global: JwtAuthGuard is applied on every controller and the realtime gateway needs the same
// check, so the cache has to be one shared instance rather than one per importing module. The
// avatar signing cache wants the same treatment for the same reason.
@Global()
@Module({
  providers: [AccountStatusService, AvatarUrlService],
  exports: [AccountStatusService, AvatarUrlService],
})
export class AccountStatusModule {}
