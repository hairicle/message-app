import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../modules/auth/auth.module';
import { MessagesModule } from '../modules/messages/messages.module';
import { ConversationsModule } from '../modules/conversations/conversations.module';

@Module({
  imports: [AuthModule, MessagesModule, ConversationsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
