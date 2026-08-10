import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import type { AvatarStorageService } from '../../common/avatar-storage.service';
import type { AvatarUrlService } from '../../common/avatar-url.service';
import { createPrismaMock, MEMBER, type PrismaMock } from '../../testing/prisma-mock';

const CONV = 'conv-1';
const USER = 'user-1';
const OTHER = 'user-2';

describe('ConversationsService', () => {
  let prisma: PrismaMock;
  let service: ConversationsService;
  let avatarStorage: { upload: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = createPrismaMock();
    avatarStorage = { upload: vi.fn().mockResolvedValue('conversation/conv-1/new.png') };
    service = new ConversationsService(
      prisma,
      avatarStorage as unknown as AvatarStorageService,
      { invalidate: vi.fn() } as unknown as AvatarUrlService,
    );
  });

  const asMember = () => prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
  const asNonMember = () => prisma.conversation_members.findUnique.mockResolvedValue(null);

  describe('updateAvatar', () => {
    const FILE = { originalname: 'g.png', mimetype: 'image/png', size: 100, buffer: Buffer.from('x') } as Express.Multer.File;
    const asGroup = () => prisma.conversations.findUnique.mockResolvedValue({ type: 'group', avatar_url: null });

    it('stores the new key when an owner uploads', async () => {
      asGroup();
      prisma.conversation_members.findUnique.mockResolvedValue({ role: 'owner' });
      prisma.conversations.update.mockResolvedValue({ id: CONV, avatar_url: 'conversation/conv-1/new.png' });

      await service.updateAvatar(CONV, USER, FILE);

      expect(prisma.conversations.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ avatar_url: 'conversation/conv-1/new.png' }) }),
      );
    });

    it('accepts an admin as well as an owner', async () => {
      asGroup();
      prisma.conversation_members.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.conversations.update.mockResolvedValue({ id: CONV, avatar_url: 'k' });
      await expect(service.updateAvatar(CONV, USER, FILE)).resolves.toBeDefined();
    });

    // The UI hides the control from plain members; that only stops them clicking it.
    it('refuses a plain member, and never reaches storage', async () => {
      asGroup();
      prisma.conversation_members.findUnique.mockResolvedValue({ role: 'member' });
      await expect(service.updateAvatar(CONV, USER, FILE)).rejects.toThrow(ForbiddenException);
      expect(avatarStorage.upload).not.toHaveBeenCalled();
      expect(prisma.conversations.update).not.toHaveBeenCalled();
    });

    it('refuses someone who is not in the conversation at all', async () => {
      asGroup();
      prisma.conversation_members.findUnique.mockResolvedValue(null);
      await expect(service.updateAvatar(CONV, OTHER, FILE)).rejects.toThrow(ForbiddenException);
      expect(avatarStorage.upload).not.toHaveBeenCalled();
    });

    // A direct conversation renders the other person's avatar, so a stored one would be unread.
    it('refuses a direct conversation even for its creator', async () => {
      prisma.conversations.findUnique.mockResolvedValue({ type: 'direct', avatar_url: null });
      await expect(service.updateAvatar(CONV, USER, FILE)).rejects.toThrow(ForbiddenException);
      expect(avatarStorage.upload).not.toHaveBeenCalled();
    });

    it('404s on a conversation that does not exist', async () => {
      prisma.conversations.findUnique.mockResolvedValue(null);
      await expect(service.updateAvatar(CONV, USER, FILE)).rejects.toThrow(NotFoundException);
    });
  });

  describe('setMuted', () => {
    it('stores the moment the mute ends', async () => {
      asMember();
      const until = new Date(Date.now() + 3600_000);
      await service.setMuted(CONV, USER, until);
      expect(prisma.conversation_members.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { muted_until: until } }),
      );
    });

    it('clears it when unmuting', async () => {
      asMember();
      await service.setMuted(CONV, USER, null);
      expect(prisma.conversation_members.update.mock.calls[0][0].data.muted_until).toBeNull();
    });

    // A past date would store a mute that is already over, which reads as muted and is not.
    it('refuses an end time that has already passed', async () => {
      asMember();
      await expect(service.setMuted(CONV, USER, new Date(Date.now() - 1000)))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
    });

    it('refuses someone who is not a member', async () => {
      asNonMember();
      await expect(service.setMuted(CONV, OTHER, null)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
    });
  });

  describe('createConversation', () => {
    const found = (rows: { id: string; count: number }[]) =>
      prisma.conversations.findMany.mockResolvedValue(
        rows.map((r) => ({ id: r.id, _count: { conversation_members: r.count } })),
      );

    // The bug: messaging the same colleague twice split the history across two chats.
    it('returns the existing direct conversation instead of a second one', async () => {
      found([{ id: 'existing', count: 2 }]);
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.conversations.findUnique.mockResolvedValue({ id: 'existing', conversation_members: [] });

      await service.createConversation(USER, { type: 'direct', memberIds: [OTHER] });

      expect(prisma.conversations.create).not.toHaveBeenCalled();
    });

    // A group containing both people also matches "both are members".
    it('ignores a conversation that has other people in it', async () => {
      found([{ id: 'a-group', count: 5 }]);
      prisma.conversations.create.mockResolvedValue({ id: 'new' });
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.conversations.findUnique.mockResolvedValue({ id: 'new', conversation_members: [] });

      await service.createConversation(USER, { type: 'direct', memberIds: [OTHER] });

      expect(prisma.conversations.create).toHaveBeenCalled();
    });

    it('creates one when the pair has never spoken', async () => {
      found([]);
      prisma.conversations.create.mockResolvedValue({ id: 'new' });
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.conversations.findUnique.mockResolvedValue({ id: 'new', conversation_members: [] });

      await service.createConversation(USER, { type: 'direct', memberIds: [OTHER] });

      expect(prisma.conversations.create).toHaveBeenCalled();
    });

    // Two groups with the same people are two legitimately different groups.
    it('never reuses anything for a group', async () => {
      prisma.conversations.create.mockResolvedValue({ id: 'new' });
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.conversations.findUnique.mockResolvedValue({ id: 'new', conversation_members: [] });

      await service.createConversation(USER, { type: 'group', name: 'g', memberIds: [OTHER] });

      expect(prisma.conversations.findMany).not.toHaveBeenCalled();
      expect(prisma.conversations.create).toHaveBeenCalled();
    });
  });

  describe('group management', () => {
    const asGroup = () => prisma.conversations.findUnique.mockResolvedValue({ type: 'group' });
    const roleIs = (...roles: (string | null)[]) => {
      let call = 0;
      prisma.conversation_members.findUnique.mockImplementation(() => {
        const r = roles[Math.min(call++, roles.length - 1)];
        return Promise.resolve(r ? { role: r } : null);
      });
    };

    describe('updateDetails', () => {
      it('lets an owner rename the group', async () => {
        asGroup();
        roleIs('owner');
        prisma.conversations.update.mockResolvedValue({});
        prisma.conversations.findUnique
          .mockResolvedValueOnce({ type: 'group' })
          .mockResolvedValueOnce({ id: CONV, conversation_members: [] });
        await service.updateDetails(CONV, USER, { name: '  New name  ' });
        expect(prisma.conversations.update.mock.calls[0][0].data.name).toBe('New name');
      });

      it('refuses a plain member', async () => {
        asGroup();
        roleIs('member');
        await expect(service.updateDetails(CONV, USER, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.conversations.update).not.toHaveBeenCalled();
      });

      it('refuses a blank name rather than storing one', async () => {
        asGroup();
        roleIs('admin');
        await expect(service.updateDetails(CONV, USER, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
      });

      it('refuses on a direct conversation', async () => {
        prisma.conversations.findUnique.mockResolvedValue({ type: 'direct' });
        await expect(service.updateDetails(CONV, USER, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    describe('addMembers', () => {
      it('refuses a plain member, and adds nobody', async () => {
        asGroup();
        roleIs('member');
        await expect(service.addMembers(CONV, USER, [OTHER])).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.conversation_members.createMany).not.toHaveBeenCalled();
      });

      it('skips ids that are not active users', async () => {
        asGroup();
        roleIs('admin');
        prisma.users.findMany.mockResolvedValue([]);
        await expect(service.addMembers(CONV, USER, ['ghost'])).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('removeMember', () => {
      it('lets anyone remove themselves — that is leaving', async () => {
        asGroup();
        roleIs('member', 'member');
        prisma.conversation_members.delete.mockResolvedValue({});
        await service.removeMember(CONV, USER, USER);
        expect(prisma.conversation_members.delete).toHaveBeenCalled();
      });

      it('refuses a plain member removing someone else', async () => {
        asGroup();
        roleIs('member');
        await expect(service.removeMember(CONV, USER, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.conversation_members.delete).not.toHaveBeenCalled();
      });

      // Otherwise an admin could remove the owner and take the group.
      it('refuses an admin removing the owner', async () => {
        asGroup();
        roleIs('admin', 'owner');
        await expect(service.removeMember(CONV, USER, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.conversation_members.delete).not.toHaveBeenCalled();
      });

      it('hands ownership on when the owner leaves', async () => {
        asGroup();
        roleIs('owner', 'owner');
        prisma.conversation_members.delete.mockResolvedValue({});
        prisma.conversation_members.findFirst.mockResolvedValue({ user_id: OTHER });
        await service.removeMember(CONV, USER, USER);
        expect(prisma.conversation_members.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { role: 'owner' } }),
        );
      });

      it('does not promote anyone when the last member leaves', async () => {
        asGroup();
        roleIs('owner', 'owner');
        prisma.conversation_members.delete.mockResolvedValue({});
        prisma.conversation_members.findFirst.mockResolvedValue(null);
        await service.removeMember(CONV, USER, USER);
        expect(prisma.conversation_members.update).not.toHaveBeenCalled();
      });

      it('404s on someone who is not in the conversation', async () => {
        asGroup();
        roleIs('owner', null);
        await expect(service.removeMember(CONV, USER, OTHER)).rejects.toBeInstanceOf(NotFoundException);
      });
    });
  });

  describe('assertMember', () => {
    it('looks the membership up by the composite key, not by conversation alone', async () => {
      asMember();
      await service.assertMember(CONV, USER);
      expect(prisma.conversation_members.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversation_id_user_id: { conversation_id: CONV, user_id: USER } },
        }),
      );
    });

    it('throws for a non-member', async () => {
      asNonMember();
      await expect(service.assertMember(CONV, USER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('media and attachments', () => {
    beforeEach(asMember);

    it('blocks a non-member before touching the data', async () => {
      asNonMember();
      await expect(service.getMedia(CONV, USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.files.findMany).not.toHaveBeenCalled();
    });

    it('getMedia asks only for image and video', async () => {
      prisma.files.findMany.mockResolvedValue([]);
      await service.getMedia(CONV, USER);
      expect(prisma.files.findMany.mock.calls[0][0].where.messages).toMatchObject({
        conversation_id: CONV,
        type: { in: ['image', 'video'] },
        deleted_at: null,
      });
    });

    it('excludes deleted messages so their attachments stop appearing', async () => {
      prisma.files.findMany.mockResolvedValue([]);
      await service.getAttachments(CONV, USER, ['file']);
      expect(prisma.files.findMany.mock.calls[0][0].where.messages.deleted_at).toBeNull();
    });

    it('converts the bigint size and flattens the message fields', async () => {
      prisma.files.findMany.mockResolvedValue([
        {
          id: 'f1', file_name: 'notes.pdf', mime_type: 'application/pdf', size_bytes: 5_000_000n,
          has_thumbnail: false, duration_secs: null, created_at: new Date('2026-08-01T00:00:00Z'),
          messages: { id: 'm1', type: 'file', created_at: new Date('2026-08-01T00:00:00Z'), sender_id: USER },
        },
      ]);
      const [row] = await service.getAttachments(CONV, USER, ['file']);
      expect(row).toMatchObject({ messageId: 'm1', type: 'file', senderId: USER });
      expect(row.file.sizeBytes).toBe(5_000_000);
      expect(typeof row.file.sizeBytes).toBe('number');
      expect(() => JSON.stringify(row)).not.toThrow();
    });
  });

  describe('getConversation', () => {
    it('returns members in a stable order with the snake_case keys the web app reads', async () => {
      asMember();
      prisma.conversations.findUnique.mockResolvedValue({
        id: CONV,
        type: 'group',
        conversation_members: [
          { role: 'owner', joined_at: new Date('2026-07-01T00:00:00Z'), users: { id: USER, username: 'a', display_name: 'Ann', avatar_url: null } },
        ],
      });
      const out = await service.getConversation(CONV, USER);
      expect(out.members[0]).toEqual({
        user_id: USER, username: 'a', display_name: 'Ann', avatar_url: null,
        role: 'owner', joined_at: new Date('2026-07-01T00:00:00Z'),
      });
      // The json_agg this replaced had no ORDER BY, so order varied between identical calls.
      expect(prisma.conversations.findUnique.mock.calls[0][0].include.conversation_members.orderBy)
        .toEqual([{ joined_at: 'asc' }, { user_id: 'asc' }]);
    });

    it('reports a missing conversation as not found', async () => {
      asMember();
      prisma.conversations.findUnique.mockResolvedValue(null);
      await expect(service.getConversation(CONV, USER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setMuted', () => {
    it('stores the moment the mute ends', async () => {
      asMember();
      const until = new Date(Date.now() + 3600_000);
      await service.setMuted(CONV, USER, until);
      expect(prisma.conversation_members.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { muted_until: until } }),
      );
    });

    it('clears it when unmuting', async () => {
      asMember();
      await service.setMuted(CONV, USER, null);
      expect(prisma.conversation_members.update.mock.calls[0][0].data.muted_until).toBeNull();
    });

    // A past date would store a mute that is already over, which reads as muted and is not.
    it('refuses an end time that has already passed', async () => {
      asMember();
      await expect(service.setMuted(CONV, USER, new Date(Date.now() - 1000)))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
    });

    it('refuses someone who is not a member', async () => {
      asNonMember();
      await expect(service.setMuted(CONV, OTHER, null)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
    });
  });

  describe('createConversation', () => {
    it('always includes the creator as owner and everyone else as member', async () => {
      prisma.conversations.create.mockResolvedValue({ id: CONV });
      asMember();
      prisma.conversations.findUnique.mockResolvedValue({ id: CONV, conversation_members: [] });

      await service.createConversation(USER, { type: 'group', memberIds: [OTHER] });

      const rows = prisma.conversations.create.mock.calls[0][0].data.conversation_members.createMany.data;
      expect(rows).toEqual([
        { user_id: USER, role: 'owner' },
        { user_id: OTHER, role: 'member' },
      ]);
    });

    it('does not add the creator twice when they are also listed as a member', async () => {
      prisma.conversations.create.mockResolvedValue({ id: CONV });
      asMember();
      prisma.conversations.findUnique.mockResolvedValue({ id: CONV, conversation_members: [] });

      await service.createConversation(USER, { type: 'group', memberIds: [USER, OTHER] });

      const rows = prisma.conversations.create.mock.calls[0][0].data.conversation_members.createMany.data;
      expect(rows.filter((r: { user_id: string }) => r.user_id === USER)).toHaveLength(1);
    });
  });

  describe('mute', () => {
    it('sets a far-future timestamp when muting and clears it when unmuting', async () => {
      prisma.conversation_members.updateMany.mockResolvedValue({ count: 1 });

      await service.muteConversation(CONV, USER, true);
      const muted = prisma.conversation_members.updateMany.mock.calls[0][0].data.muted_until;
      expect(muted).toBeInstanceOf(Date);
      expect(muted.getTime()).toBeGreaterThan(Date.now());

      await service.muteConversation(CONV, USER, false);
      expect(prisma.conversation_members.updateMany.mock.calls[1][0].data.muted_until).toBeNull();
    });

    it('scopes the update to this user, not the whole conversation', async () => {
      prisma.conversation_members.updateMany.mockResolvedValue({ count: 1 });
      await service.muteConversation(CONV, USER, true);
      expect(prisma.conversation_members.updateMany.mock.calls[0][0].where).toEqual({
        conversation_id: CONV, user_id: USER,
      });
    });
  });

  describe('pinning', () => {
    it('refuses to pin in a conversation the user is not in', async () => {
      asNonMember();
      await expect(service.pinMessage(CONV, 'msg-1', USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.pinned_messages.upsert).not.toHaveBeenCalled();
    });

    it('pinning twice is idempotent', async () => {
      asMember();
      prisma.pinned_messages.upsert.mockResolvedValue({});
      await service.pinMessage(CONV, 'msg-1', USER);
      expect(prisma.pinned_messages.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    });
  });

  describe('listConversations', () => {
    it('passes the caller id to the raw query so rows are scoped to their memberships', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.listConversations(USER);
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain(USER);
    });
  });
});
