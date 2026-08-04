import {
  Controller, Get, Post, Delete, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
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
  async list(@CurrentUser() user: AuthPayload) {
    const conversations = await this.conversationsService.listConversations(user.id);
    return { conversations };
  }

  @Post()
  async create(@CurrentUser() user: AuthPayload, @Body() body: {
    type: string; name?: string; description?: string; memberIds?: string[]; teamId?: string;
  }) {
    const conversation = await this.conversationsService.createConversation(user.id, body);
    return { conversation };
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    const conversation = await this.conversationsService.getConversation(id, user.id);
    return { conversation };
  }

  @Get(':id/media')
  async media(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    const media = await this.conversationsService.getMedia(id, user.id);
    return { media };
  }

  @Get(':id/attachments')
  async attachments(
    @Param('id') id: string,
    @Query('types') types: string | undefined,
    @CurrentUser() user: AuthPayload,
  ) {
    const typeList = (types ?? 'file').split(',').map((t) => t.trim()).filter(Boolean);
    const items = await this.conversationsService.getAttachments(id, user.id, typeList);
    return { items };
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
