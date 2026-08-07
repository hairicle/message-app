import {
  Controller, Get, Post, Patch, Body, Param, UseGuards, NotFoundException,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
    return { profile };
  }

  @Patch('me')
  async updateProfile(@CurrentUser() user: AuthPayload, @Body() body: { displayName?: string; username?: string }) {
    await this.usersService.updateProfile(user.id, body);
    const profile = await this.usersService.getProfile(user.id);
    return { profile };
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })] }))
    file: Express.Multer.File,
    @CurrentUser() user: AuthPayload,
  ) {
    const profile = await this.usersService.uploadAvatar(user.id, file);
    return { profile };
  }

  @Post('me/password')
  async changePassword(@CurrentUser() user: AuthPayload, @Body() body: { currentPassword: string; newPassword: string }) {
    await this.usersService.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Get('me/notifications')
  async getNotificationPrefs(@CurrentUser() user: AuthPayload) {
    const prefs = await this.usersService.getNotificationPrefs(user.id);
    return { prefs };
  }

  @Patch('me/notifications')
  async updateNotificationPrefs(
    @CurrentUser() user: AuthPayload,
    @Body() body: { soundEnabled?: boolean; desktopEnabled?: boolean; emailEnabled?: boolean },
  ) {
    const prefs = await this.usersService.updateNotificationPrefs(user.id, body);
    return { prefs };
  }

  @Get('directory')
  async listDirectory(@CurrentUser() user: AuthPayload) {
    const users = await this.usersService.listDirectory(user.id);
    return { users };
  }

  @Get()
  @Roles('admin')
  async listUsers() {
    return this.usersService.listUsers();
  }

  @Post()
  @Roles('admin')
  async createUser(@Body() body: { email: string; username: string; displayName: string; password: string; role?: string; department?: string | null }) {
    return this.usersService.createUser(body);
  }

  // Declared last on purpose: Nest matches routes in order, so a ':id' parameter route placed
  // above would swallow /users/me and /users/directory.
  @Get(':id')
  async getPublicProfile(@Param('id') id: string) {
    const profile = await this.usersService.getPublicProfile(id);
    if (!profile) throw new NotFoundException('User not found');
    return { profile };
  }
}
