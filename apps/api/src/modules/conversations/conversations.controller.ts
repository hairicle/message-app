import {
  Controller, Get, Post, Delete, Put, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthPayload) {
    return this.conversationsService.listConversations(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: {
    type: string; name?: string; description?: string; memberIds?: string[]; teamId?: string;
  }) {
    return this.conversationsService.createConversation(user.id, body);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.conversationsService.getConversation(id, user.id);
  }

  @Get(':id/pins')
  listPins(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.conversationsService.listPinnedMessages(id, user.id);
  }

  @Post(':id/pins')
  pin(@Param('id') id: string, @CurrentUser() user: AuthPayload, @Body() body: { messageId: string }) {
    return this.conversationsService.pinMessage(id, body.messageId, user.id);
  }

  @Delete(':id/pins/:messageId')
  unpin(@Param('id') id: string, @Param('messageId') messageId: string, @CurrentUser() user: AuthPayload) {
    return this.conversationsService.unpinMessage(id, messageId, user.id);
  }

  @Put(':id/mute')
  mute(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.conversationsService.muteConversation(id, user.id, true);
  }

  @Delete(':id/mute')
  unmute(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.conversationsService.muteConversation(id, user.id, false);
  }
}
