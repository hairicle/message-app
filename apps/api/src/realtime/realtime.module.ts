import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
