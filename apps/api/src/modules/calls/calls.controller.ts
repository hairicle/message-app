import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  list(@CurrentUser() user: AuthPayload) {
    return this.callsService.listCalls(user.id);
  }

  @Post()
  start(@CurrentUser() user: AuthPayload, @Body() body: { conversationId: string; type?: 'audio' | 'video' }) {
    // calls.type is NOT NULL with no default, so it has to come from the request.
    return this.callsService.startCall(user.id, body.conversationId, body.type ?? 'audio');
  }

  @Delete(':id')
  end(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.callsService.endCall(id, user.id);
  }
}
