import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AvatarUrlService } from '../../common/avatar-url.service';
import { AvatarStorageService } from '../../common/avatar-storage.service';

/** Matches what the profile form asks for, so the two cannot disagree about what is acceptable. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * bcrypt ignores everything past 72 bytes.
 *
 * Not a limit this application chose — it is the algorithm's, and accepting a longer password while
 * silently hashing only the first 72 bytes tells someone their passphrase is stronger than it is. A
 * live check confirmed it: an account set with a 102-character password opened with the first 72 of
 * them. Counted in bytes rather than characters, because bytes are what bcrypt truncates; one emoji
 * is four of them.
 */
const MAX_PASSWORD_BYTES = 72;

/** Both ends of the rule, applied wherever a password is set. */
function assertPasswordAcceptable(password: string): void {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(`A password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new BadRequestException(
      `A password can be at most ${MAX_PASSWORD_BYTES} bytes — anything beyond that is ignored when it is hashed`,
    );
  }
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avatars: AvatarUrlService,
    private readonly avatarStorage: AvatarStorageService,
  ) {}

  async getProfile(userId: string) {
    const row = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, username: true, display_name: true,
        avatar_url: true, department: true, role: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id, email: row.email, username: row.username,
      displayName: row.display_name, avatarUrl: row.avatar_url,
      department: row.department, role: row.role,
    };
  }

  /**
   * What one colleague may see about another. Email is left out on purpose: listDirectory has
   * never exposed it, and this endpoint is reachable by any signed-in user, so it should not
   * widen what the directory already publishes.
   */
  async getPublicProfile(userId: string) {
    const row = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, display_name: true,
        avatar_url: true, department: true, role: true, status: true,
        last_seen_at: true,
      },
    });
    if (!row || row.status !== 'active') return null;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      department: row.department,
      role: row.role,
      lastSeenAt: row.last_seen_at,
    };
  }

  // Note: listDirectory and listUsers deliberately return snake_case rows — the web app reads
  // `avatar_url`, `display_name` and `created_at` directly from these payloads.
  async listDirectory(currentUserId: string) {
    return this.prisma.users.findMany({
      where: { id: { not: currentUserId }, status: 'active' },
      select: { id: true, username: true, display_name: true, avatar_url: true, department: true },
      orderBy: { display_name: 'asc' },
    });
  }

  async listUsers() {
    const users = await this.prisma.users.findMany({
      select: {
        id: true, email: true, username: true, display_name: true,
        role: true, department: true, status: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    return { users };
  }

  async createUser(data: { email: string; username: string; displayName: string; password: string; role?: string; department?: string | null }) {
    // The same rule the self-service change applies. An account an administrator creates should
    // not be allowed a password the person could never set for themselves afterwards.
    assertPasswordAcceptable(data.password);
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(data.password, 12);
    const user = await this.prisma.users.create({
      data: {
        email: data.email,
        username: data.username,
        display_name: data.displayName,
        password_hash: hash,
        role: data.role ?? 'staff',
        department: data.department ?? null,
        status: 'active',
      },
      select: { id: true },
    });
    return { id: user.id };
  }

  async updateProfile(userId: string, data: { displayName?: string; username?: string }) {
    // The previous SQL used COALESCE so a missing field left the column untouched; omitting the
    // key from `data` has the same effect. Only these two fields are ever written, which is what
    // keeps a forged `role` in the request body from taking effect.
    const patch: Prisma.usersUpdateInput = { updated_at: new Date() };
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (data.username !== undefined) patch.username = data.username;
    await this.prisma.users.update({ where: { id: userId }, data: patch });
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    // Store the object key, not a public URL — the bucket is private and the response layer signs
    // it per request. Rows written before this change still hold a full URL; AvatarUrlService
    // accepts both shapes, so no backfill is needed.
    const storageKey = await this.avatarStorage.upload(userId, file);
    const previous = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { avatar_url: true },
    });
    await this.prisma.users.update({
      where: { id: userId },
      data: { avatar_url: storageKey, updated_at: new Date() },
    });
    this.avatars.invalidate(previous?.avatar_url ?? null);
    return this.getProfile(userId);
  }

  async getNotificationPrefs(userId: string) {
    const row = await this.prisma.notification_preferences.findUnique({ where: { user_id: userId } });
    return {
      soundEnabled: row?.sound_enabled ?? true,
      desktopEnabled: row?.desktop_enabled ?? true,
      emailEnabled: row?.email_enabled ?? false,
    };
  }

  async updateNotificationPrefs(
    userId: string,
    data: { soundEnabled?: boolean; desktopEnabled?: boolean; emailEnabled?: boolean },
  ) {
    // Was an INSERT … ON CONFLICT DO UPDATE with COALESCE per column: absent fields keep their
    // stored value, and on first write fall back to the column defaults.
    const patch: Prisma.notification_preferencesUpdateInput = { updated_at: new Date() };
    if (data.soundEnabled !== undefined) patch.sound_enabled = data.soundEnabled;
    if (data.desktopEnabled !== undefined) patch.desktop_enabled = data.desktopEnabled;
    if (data.emailEnabled !== undefined) patch.email_enabled = data.emailEnabled;

    await this.prisma.notification_preferences.upsert({
      where: { user_id: userId },
      update: patch,
      create: {
        user_id: userId,
        sound_enabled: data.soundEnabled ?? true,
        desktop_enabled: data.desktopEnabled ?? true,
        email_enabled: data.emailEnabled ?? false,
      },
    });
    return this.getNotificationPrefs(userId);
  }

  /**
   * Change your own password, having proved you know the current one.
   *
   * Getting the current password wrong is the caller's mistake, not a server fault: this used to
   * throw a plain Error, which is not an HttpException, so it came back as 500 "Internal server
   * error" — and the profile form shows the server's message verbatim, so mistyping told the user
   * the system had broken.
   *
   * 400 rather than 401 deliberately. Any 401 outside the sign-in paths makes the client treat
   * the session as expired and sign the user out, so answering 401 here would log someone out for
   * a typo.
   */
  async changePassword(userId: string, current: string, next: string) {
    // Checked here as well as in the form, because the endpoint is reachable without it.
    assertPasswordAcceptable(next);

    const bcrypt = await import('bcryptjs');
    const row = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { password_hash: true },
    });
    const hash = row?.password_hash;
    if (!hash || !(await bcrypt.compare(current, hash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const newHash = await bcrypt.hash(next, 12);
    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: newHash },
    });
  }
}
