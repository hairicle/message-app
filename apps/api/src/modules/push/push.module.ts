import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { MessagesModule } from '../messages/messages.module';

/**
 * Push lives in its own module and subscribes to the messages service's emitter, the same way the
 * realtime gateway does. It is not part of MessagesModule, because sending a message must not
 * depend on notifications being available.
 */
@Module({
  imports: [MessagesModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
