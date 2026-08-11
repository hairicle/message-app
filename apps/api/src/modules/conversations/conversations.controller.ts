import {
  Controller, Get, Post, Delete, Patch, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ConversationsService } from './conversations.service';
import { MAX_AVATAR_SIZE } from '../files/file-rules';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  name: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  memberIds: z.array(z.string().uuid()).max(500).optional(),
  teamId: z.string().uuid().optional(),
});

const addMembersSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(500) });

const updateDetailsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
});

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
  async create(@CurrentUser() user: AuthPayload, @Body() body: unknown) {
    // `type` reached Prisma as an enum value and any other word came back as 500. It is the one
    // field here with only two legal answers, so it is the one worth naming in the error.
    const parsed = createConversationSchema.parse(body);
    const conversation = await this.conversationsService.createConversation(user.id, parsed);
    return { conversation };
  }

  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  async uploadAvatar(
    @Param('id') id: string,
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_AVATAR_SIZE })] }))
    file: Express.Multer.File,
    @CurrentUser() user: AuthPayload,
  ) {
    const conversation = await this.conversationsService.updateAvatar(id, user.id, file);
    return { conversation };
  }

  /** `until` is an ISO timestamp, or null to unmute. */
  @Post(':id/mute')
  async setMuted(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { until?: string | null },
  ) {
    const until = body.until ? new Date(body.until) : null;
    if (until && Number.isNaN(until.getTime())) {
      throw new BadRequestException('until must be an ISO timestamp, or null');
    }
    return this.conversationsService.setMuted(id, user.id, until);
  }

  @Post(':id/pin')
  async setPinned(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { pinned?: boolean },
  ) {
    return this.conversationsService.setPinned(id, user.id, body.pinned !== false);
  }

  @Patch(':id')
  async updateDetails(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: unknown,
  ) {
    const parsed = updateDetailsSchema.parse(body);
    const conversation = await this.conversationsService.updateDetails(id, user.id, parsed);
    return { conversation };
  }

  @Post(':id/members')
  async addMembers(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: unknown,
  ) {
    const { userIds } = addMembersSchema.parse(body);
    const conversation = await this.conversationsService.addMembers(id, user.id, userIds);
    return { conversation };
  }

  /** Removing yourself is leaving; removing someone else needs owner or admin. */
  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    return this.conversationsService.removeMember(id, user.id, userId);
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
