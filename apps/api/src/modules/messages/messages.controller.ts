import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get(':conversationId')
  list(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthPayload,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.listMessages(conversationId, user.id, before, limit ? Number(limit) : 50);
  }

  @Post(':conversationId')
  send(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { type: string; ciphertext: string; replyToMessageId?: string; fileId?: string },
  ) {
    return this.messagesService.sendMessage(conversationId, user.id, body);
  }

  @Patch(':id')
  edit(@Param('id') id: string, @CurrentUser() user: AuthPayload, @Body() body: { ciphertext: string }) {
    return this.messagesService.editMessage(id, user.id, body.ciphertext);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.deleteMessage(id, user.id);
  }

  @Post(':id/reactions')
  react(@Param('id') id: string, @CurrentUser() user: AuthPayload, @Body() body: { emoji: string | null }) {
    return this.messagesService.reactToMessage(id, user.id, body.emoji);
  }

  @Post(':conversationId/read')
  markRead(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.markRead(conversationId, user.id);
  }
}
