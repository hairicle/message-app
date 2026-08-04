import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // Static sub-routes must come before /:id to avoid shadowing
  @Get('search')
  async search(
    @Query('q') q: string,
    @Query('conversationId') conversationId: string | undefined,
    @CurrentUser() user: AuthPayload,
  ) {
    const results = await this.messagesService.searchMessages(q, user.id, conversationId);
    return { results, total: results.length, query: q };
  }

  @Get('pinned')
  async pinned(
    @Query('conversationId') conversationId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    const pinned = await this.messagesService.listPinned(conversationId, user.id);
    return { pinned };
  }

  @Get('bookmarks')
  async bookmarks(
    @Query('conversationId') conversationId: string | undefined,
    @CurrentUser() user: AuthPayload,
  ) {
    const bookmarks = await this.messagesService.listBookmarks(user.id, conversationId);
    return { bookmarks };
  }

  @Get('undelivered')
  async undelivered(@CurrentUser() user: AuthPayload) {
    const messages = await this.messagesService.listUndelivered(user.id);
    return { messages };
  }

  // List messages — GET /api/messages?conversationId=xxx&before=xxx
  @Get()
  async list(
    @Query('conversationId') conversationId: string,
    @Query('before') before: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: AuthPayload,
  ) {
    const messages = await this.messagesService.listMessages(
      conversationId, user.id, before, limit ? Number(limit) : 50,
    );
    return { messages };
  }

  // Send message — POST /api/messages
  @Post()
  async send(
    @Body() body: {
      conversationId: string;
      type?: string;
      ciphertext?: string;
      replyToMessageId?: string;
      fileId?: string;
    },
    @CurrentUser() user: AuthPayload,
  ) {
    const message = await this.messagesService.sendMessage(body.conversationId, user.id, body);
    return { message };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    await this.messagesService.markRead(id, user.id);
    return {};
  }

  @Post(':id/reactions')
  async addReaction(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { emoji: string },
  ) {
    await this.messagesService.addReaction(id, user.id, body.emoji);
    return {};
  }

  @Delete(':id/reactions/:emoji')
  async removeReaction(
    @Param('id') id: string,
    @Param('emoji') emoji: string,
    @CurrentUser() user: AuthPayload,
  ) {
    await this.messagesService.removeReaction(id, user.id, decodeURIComponent(emoji));
    return {};
  }

  @Post(':id/pin')
  async pin(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.pinMessage(id, user.id);
  }

  @Delete(':id/pin')
  async unpin(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.unpinMessage(id, user.id);
  }

  @Post(':id/bookmark')
  async bookmark(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.bookmarkMessage(id, user.id);
  }

  @Delete(':id/bookmark')
  async unbookmark(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.messagesService.unbookmarkMessage(id, user.id);
  }

  @Post(':id/forward')
  async forward(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { targetConversationId: string },
  ) {
    const message = await this.messagesService.forwardMessage(id, user.id, body.targetConversationId);
    return { message };
  }

  @Patch(':id')
  async edit(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { ciphertext: string },
  ) {
    const message = await this.messagesService.editMessage(id, user.id, body.ciphertext);
    return { message };
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    const message = await this.messagesService.deleteMessage(id, user.id);
    return { message };
  }
}
