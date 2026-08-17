import {
  Controller, Get, Post, Patch, Body, Param, UseGuards, NotFoundException,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { UsersService } from './users.service';
import { MAX_AVATAR_SIZE } from '../files/file-rules';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPayload } from '@messenger/shared';

/** The length rule lives in the service too, which is what enforces it; this only rejects earlier. */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

/** Every flag optional: a client sends only what it is changing, and the rest keeps its value. */
const notificationPrefsSchema = z.object({
  soundEnabled: z.boolean().optional(),
  desktopEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  username: z.string().min(1).max(50).optional(),
});

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
  async updateProfile(@CurrentUser() user: AuthPayload, @Body() rawBody: unknown) {
    // Parsing also strips anything else the caller sent. The service already ignores `role` and
    // `status`, verified live, but a schema makes that a property of the endpoint rather than
    // something the next person to edit the service has to remember.
    const body = updateProfileSchema.parse(rawBody);
    await this.usersService.updateProfile(user.id, body);
    const profile = await this.usersService.getProfile(user.id);
    return { profile };
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_SIZE } }))
  async uploadAvatar(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_AVATAR_SIZE })] }))
    file: Express.Multer.File,
    @CurrentUser() user: AuthPayload,
  ) {
    const profile = await this.usersService.uploadAvatar(user.id, file);
    return { profile };
  }

  @Post('me/password')
  async changePassword(@CurrentUser() user: AuthPayload, @Body() body: unknown) {
    // Omitting currentPassword used to answer 500: the check is there and correct, but it reached
    // bcrypt.compare(undefined, hash), which throws before the comparison can return false. A
    // server error on a password-change endpoint is the kind of log line that reads as a breach.
    const { currentPassword, newPassword } = changePasswordSchema.parse(body);
    await this.usersService.changePassword(user.id, currentPassword, newPassword);
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
    @Body() body: unknown,
  ) {
    const prefs = await this.usersService.updateNotificationPrefs(user.id, notificationPrefsSchema.parse(body));
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
