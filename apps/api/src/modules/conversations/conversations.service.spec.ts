import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { createPrismaMock, MEMBER, type PrismaMock } from '../../testing/prisma-mock';

const CONV = 'conv-1';
const USER = 'user-1';
const OTHER = 'user-2';

describe('ConversationsService', () => {
  let prisma: PrismaMock;
  let service: ConversationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ConversationsService(prisma);
  });

  const asMember = () => prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
  const asNonMember = () => prisma.conversation_members.findUnique.mockResolvedValue(null);

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
