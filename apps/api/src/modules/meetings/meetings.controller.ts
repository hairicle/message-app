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

  // Body shape follows the meetings table: start_at/end_at/location, attendees rather than
  // participants, and no conversation_id column.
  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: {
    title: string; description?: string; location?: string;
    startAt: string; endAt?: string; attendeeIds?: string[];
  }) {
    return this.meetingsService.createMeeting(user.id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.meetingsService.deleteMeeting(id, user.id);
  }
}
