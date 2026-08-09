import { Module, Global } from '@nestjs/common';
import { AccountStatusService } from './account-status.service';
import { AvatarUrlService } from './avatar-url.service';
import { AvatarStorageService } from './avatar-storage.service';

// Global: JwtAuthGuard is applied on every controller and the realtime gateway needs the same
// check, so the cache has to be one shared instance rather than one per importing module. The
// avatar signing cache wants the same treatment for the same reason.
@Global()
@Module({
  providers: [AccountStatusService, AvatarUrlService, AvatarStorageService],
  exports: [AccountStatusService, AvatarUrlService, AvatarStorageService],
})
export class AccountStatusModule {}
