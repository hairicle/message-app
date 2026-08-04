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
  async list(@CurrentUser() user: AuthPayload) {
    const teams = await this.teamsService.listTeams(user.id);
    return { teams };
  }

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: { name: string; description?: string }) {
    return this.teamsService.createTeam(user.id, body);
  }

  @Get(':id/members')
  async getMembers(@Param('id') id: string) {
    const members = await this.teamsService.getMembers(id);
    return { members };
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
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    return this.teamsService.removeMember(id, user.id, userId);
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.teamsService.getMessages(id, user.id);
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { content: string },
  ) {
    const message = await this.teamsService.sendMessage(id, user.id, body.content);
    return { message };
  }

  @Get(':id/pinned')
  async getPinned(@Param('id') id: string) {
    const pinned = await this.teamsService.getPinned(id);
    return { pinned };
  }
}
