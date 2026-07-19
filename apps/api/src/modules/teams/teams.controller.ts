import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  list(@CurrentUser() user: AuthPayload) {
    return this.teamsService.listTeams(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: { name: string; description?: string }) {
    return this.teamsService.createTeam(user.id, body);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { userId: string; role?: string },
  ) {
    return this.teamsService.addMember(id, user.id, body.userId, body.role);
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: AuthPayload) {
    return this.teamsService.removeMember(id, user.id, userId);
  }
}
