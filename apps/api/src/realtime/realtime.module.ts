import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../modules/auth/auth.module';
import { MessagesModule } from '../modules/messages/messages.module';

@Module({
  imports: [AuthModule, MessagesModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
