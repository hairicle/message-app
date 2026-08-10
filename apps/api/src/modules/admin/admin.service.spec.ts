import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { createPrismaMock, type PrismaMock } from '../../testing/prisma-mock';
import type { AuthService } from '../auth/auth.service';
import type { AccountStatusService } from '../../common/account-status.service';

const ADMIN = 'admin-1';
const OTHER_ADMIN = 'admin-2';
const STAFF = 'staff-1';

describe('AdminService', () => {
  let prisma: PrismaMock;
  let service: AdminService;
  let accountStatus: { evict: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = createPrismaMock();
    accountStatus = { evict: vi.fn() };
    service = new AdminService(
      prisma,
      { blockUser: vi.fn(), unblockUser: vi.fn() } as unknown as AuthService,
      accountStatus as unknown as AccountStatusService,
    );
    prisma.audit_logs.create.mockResolvedValue({});
    prisma.users.updateMany.mockResolvedValue({ count: 1 });
    prisma.users.deleteMany.mockResolvedValue({ count: 1 });
  });

  /** The account being changed, and how many other active admins remain. */
  const target = (role: string, status = 'active', othersRemaining = 1) => {
    prisma.users.findUnique.mockResolvedValue({ role, status, email: 'x@y.z', username: 'x' });
    prisma.users.count.mockResolvedValue(othersRemaining);
  };

  describe('roles', () => {
    it('refuses a role the application does not know', async () => {
      target('staff');
      await expect(service.updateUser(STAFF, { role: 'wizard' }, ADMIN))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.users.updateMany).not.toHaveBeenCalled();
    });

    it('accepts a known role whatever its capitalisation, and stores it lowercased', async () => {
      target('staff');
      await service.updateUser(STAFF, { role: 'Manager' }, ADMIN);
      expect(prisma.users.updateMany.mock.calls[0][0].data.role).toBe('manager');
    });

    // Otherwise a rejected role still renames the account.
    it('writes nothing at all when one field is invalid', async () => {
      target('staff');
      await service.updateUser(STAFF, { displayName: 'New', role: 'wizard' }, ADMIN).catch(() => undefined);
      expect(prisma.users.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('lockout', () => {
    it('refuses to delete your own account', async () => {
      target('admin', 'active', 5);
      await expect(service.deleteUser(ADMIN, ADMIN)).rejects.toThrow(/your own account/);
      expect(prisma.users.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to disable your own account', async () => {
      target('admin', 'active', 5);
      await expect(service.disableUser(ADMIN, ADMIN)).rejects.toThrow(/your own account/);
    });

    it('allows stepping down while other administrators remain', async () => {
      target('admin', 'active', 2);
      await expect(service.updateUser(ADMIN, { role: 'staff' }, ADMIN)).resolves.toBeDefined();
    });

    // The case the live run could not reach: only an active admin can call these, so a target who
    // is the last admin is normally yourself. A token issued before a demotion is the exception.
    it('refuses to remove the last administrator, even when it is someone else', async () => {
      target('admin', 'active', 0);
      await expect(service.deleteUser(OTHER_ADMIN, ADMIN)).rejects.toThrow(/only administrator/);
      expect(prisma.users.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to demote the last administrator', async () => {
      target('admin', 'active', 0);
      await expect(service.changeUserRole(OTHER_ADMIN, 'staff', ADMIN)).rejects.toThrow(/only administrator/);
    });

    it('refuses to disable the last administrator', async () => {
      target('admin', 'active', 0);
      await expect(service.disableUser(OTHER_ADMIN, ADMIN)).rejects.toThrow(/only administrator/);
    });

    it('lets an ordinary account be removed regardless of how many admins there are', async () => {
      target('staff', 'active', 0);
      await expect(service.deleteUser(STAFF, ADMIN)).resolves.toBeDefined();
    });

    // An already-disabled admin is not the last active one, so removing them changes nothing.
    it('does not count a disabled administrator as the last one', async () => {
      target('admin', 'disabled', 0);
      await expect(service.deleteUser(OTHER_ADMIN, ADMIN)).resolves.toBeDefined();
    });
  });

  describe('audit', () => {
    it('records who did what, to whom', async () => {
      target('staff');
      await service.disableUser(STAFF, ADMIN);
      expect(prisma.audit_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'admin.user.disabled', user_id: ADMIN, target_id: STAFF }),
        }),
      );
    });

    it('drops the cached role so a demotion takes effect at once', async () => {
      target('staff');
      await service.changeUserRole(STAFF, 'admin', ADMIN);
      expect(accountStatus.evict).toHaveBeenCalledWith(STAFF);
    });

    it('keeps both ends of a role change', async () => {
      target('staff');
      await service.changeUserRole(STAFF, 'manager', ADMIN);
      const data = prisma.audit_logs.create.mock.calls[0][0].data;
      expect(data.metadata).toEqual({ from: 'staff', to: 'manager' });
    });

    it('names a deleted account, which no longer exists to be looked up', async () => {
      target('staff');
      await service.deleteUser(STAFF, ADMIN);
      const data = prisma.audit_logs.create.mock.calls[0][0].data;
      expect(data.metadata).toMatchObject({ email: 'x@y.z', username: 'x' });
    });

    // Refusing to disable an account because its log row would not write is the wrong way round.
    it('does not fail the action when the audit write fails', async () => {
      target('staff');
      prisma.audit_logs.create.mockRejectedValue(new Error('audit table gone'));
      await expect(service.disableUser(STAFF, ADMIN)).resolves.toBeUndefined();
      expect(prisma.users.updateMany).toHaveBeenCalled();
    });
  });
});
