import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: AuthPayload) {
    return this.meetingsService.listMeetings(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: {
    title: string; description?: string; startsAt: string; endsAt: string;
    conversationId?: string; participantIds: string[];
  }) {
    return this.meetingsService.createMeeting(user.id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.meetingsService.deleteMeeting(id, user.id);
  }
}
