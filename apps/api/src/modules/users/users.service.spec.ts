import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { createPrismaMock, type PrismaMock } from '../../testing/prisma-mock';
import type { AvatarUrlService } from '../../common/avatar-url.service';
import type { AvatarStorageService } from '../../common/avatar-storage.service';

const USER = 'user-1';
const CURRENT = 'current-password';

describe('UsersService.changePassword', () => {
  let prisma: PrismaMock;
  let service: UsersService;
  let storedHash: string;

  beforeEach(async () => {
    prisma = createPrismaMock();
    service = new UsersService(
      prisma,
      { invalidate: vi.fn() } as unknown as AvatarUrlService,
      { upload: vi.fn() } as unknown as AvatarStorageService,
    );
    // A real hash, so the comparison under test is the real one.
    storedHash = await bcrypt.hash(CURRENT, 4);
    prisma.users.findUnique.mockResolvedValue({ password_hash: storedHash });
  });

  it('changes the password when the current one is right', async () => {
    await service.changePassword(USER, CURRENT, 'a-new-password');
    const written = prisma.users.update.mock.calls[0][0].data.password_hash;
    expect(await bcrypt.compare('a-new-password', written)).toBe(true);
  });

  // The bug: a plain Error is not an HttpException, so this came back as 500 "Internal server
  // error" — and the profile form shows that message to the person who simply mistyped.
  it('answers 400, not 500, when the current password is wrong', async () => {
    await expect(service.changePassword(USER, 'wrong', 'a-new-password'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('says what was actually wrong', async () => {
    await expect(service.changePassword(USER, 'wrong', 'a-new-password'))
      .rejects.toThrow('Current password is incorrect');
  });

  it('does not write anything when the current password is wrong', async () => {
    await service.changePassword(USER, 'wrong', 'a-new-password').catch(() => undefined);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  // 401 outside the sign-in paths makes the client drop the session, so a typo must not be one.
  it('is not an authentication failure, which would sign the user out', async () => {
    const err = await service.changePassword(USER, 'wrong', 'a-new-password').catch((e) => e);
    expect(err.getStatus()).toBe(400);
  });

  it('refuses a password shorter than the form allows', async () => {
    await expect(service.changePassword(USER, CURRENT, 'short'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('refuses an empty new password', async () => {
    await expect(service.changePassword(USER, CURRENT, '')).rejects.toBeInstanceOf(BadRequestException);
  });

  // Checked before the current password, so an unusable new one is reported without a round-trip
  // through bcrypt — and without telling an attacker whether the current guess was right.
  it('rejects a short password without revealing whether the current one was right', async () => {
    await expect(service.changePassword(USER, 'also-wrong', 'short'))
      .rejects.toThrow(/at least 8 characters/);
  });

  it('refuses when the account has no password set', async () => {
    prisma.users.findUnique.mockResolvedValue({ password_hash: null });
    await expect(service.changePassword(USER, CURRENT, 'a-new-password'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
