import {
  Controller, Get, Post, Patch, Body, Param, UseGuards, NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMyProfile(@CurrentUser() user: AuthPayload) {
    const profile = await this.usersService.getProfile(user.id);
    if (!profile) throw new NotFoundException('User not found');
    return { user: profile };
  }

  @Patch('me')
  async updateProfile(@CurrentUser() user: AuthPayload, @Body() body: { displayName?: string; username?: string }) {
    await this.usersService.updateProfile(user.id, body);
    return { ok: true };
  }

  @Post('me/password')
  async changePassword(@CurrentUser() user: AuthPayload, @Body() body: { currentPassword: string; newPassword: string }) {
    await this.usersService.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Get('directory')
  async listDirectory(@CurrentUser() user: AuthPayload) {
    return this.usersService.listDirectory(user.id);
  }

  @Get()
  @Roles('admin')
  async listUsers() {
    return this.usersService.listUsers();
  }

  @Post()
  @Roles('admin')
  async createUser(@Body() body: { email: string; username: string; displayName: string; password: string; role?: string }) {
    return this.usersService.createUser(body);
  }
}
