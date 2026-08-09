import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { createPrismaMock, MEMBER, type PrismaMock } from '../../testing/prisma-mock';

const CONV = 'conv-1';
const USER = 'user-1';
const OTHER = 'user-2';
const MSG = 'msg-1';

const bytes = (s: string) => Buffer.from(s, 'utf8');

/** Minimal row in the shape listMessages selects. */
const messageRow = (over: Record<string, unknown> = {}) => ({
  id: MSG,
  conversation_id: CONV,
  sender_id: USER,
  type: 'text',
  ciphertext: bytes('hello'),
  reply_to_message_id: null,
  forwarded_from_message_id: null,
  created_at: new Date('2026-08-01T10:00:00Z'),
  edited_at: null,
  deleted_at: null,
  files: [],
  message_reactions: [],
  ...over,
});

describe('MessagesService', () => {
  let prisma: PrismaMock;
  let service: MessagesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new MessagesService(prisma);
  });

  const asMember = () => prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
  const asNonMember = () => prisma.conversation_members.findUnique.mockResolvedValue(null);

  // ── Membership: the authorisation boundary on every entry point ────────────────
  describe('membership enforcement', () => {
    it('refuses to list messages for a non-member', async () => {
      asNonMember();
      await expect(service.listMessages(CONV, USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.findMany).not.toHaveBeenCalled();
    });

    it('refuses to send as a non-member', async () => {
      asNonMember();
      await expect(service.sendMessage(CONV, USER, { ciphertext: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.create).not.toHaveBeenCalled();
    });

    it('checks membership of the message\'s own conversation when reacting', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      asNonMember();
      await expect(service.addReaction(MSG, USER, '👍')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversation_members.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversation_id_user_id: { conversation_id: CONV, user_id: USER } },
        }),
      );
      expect(prisma.message_reactions.upsert).not.toHaveBeenCalled();
    });

    it('refuses to bookmark a message in a conversation the user is not in', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      asNonMember();
      await expect(service.bookmarkMessage(MSG, USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user_bookmarks.upsert).not.toHaveBeenCalled();
    });
  });

  // ── listMessages ──────────────────────────────────────────────────────────────
  describe('listMessages', () => {
    beforeEach(asMember);

    it('returns oldest-first even though the query fetches newest-first', async () => {
      // The query orders desc so LIMIT takes the newest page; the result is reversed for display.
      prisma.messages.findMany.mockResolvedValue([
        messageRow({ id: 'newer', created_at: new Date('2026-08-01T12:00:00Z') }),
        messageRow({ id: 'older', created_at: new Date('2026-08-01T10:00:00Z') }),
      ]);
      const out = await service.listMessages(CONV, USER);
      expect(out.map((m) => m.id)).toEqual(['older', 'newer']);
      expect(prisma.messages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { created_at: 'desc' } }),
      );
    });

    it('decodes the bytea body to text', async () => {
      prisma.messages.findMany.mockResolvedValue([messageRow({ ciphertext: bytes('សួស្តី 👋') })]);
      const [m] = await service.listMessages(CONV, USER);
      expect(m.ciphertext).toBe('សួស្តី 👋');
    });

    it('resolves `before` against the anchor message and scopes it to this conversation', async () => {
      const anchor = new Date('2026-08-01T09:00:00Z');
      prisma.messages.findFirst.mockResolvedValue({ created_at: anchor });
      prisma.messages.findMany.mockResolvedValue([]);

      await service.listMessages(CONV, USER, 'anchor-id', 25);

      // Scoping by conversation_id stops an id from another conversation shifting the window.
      expect(prisma.messages.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'anchor-id', conversation_id: CONV } }),
      );
      expect(prisma.messages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversation_id: CONV, created_at: { lt: anchor } },
          take: 25,
        }),
      );
    });

    it('returns nothing for an unknown `before` id, as the SQL subquery did', async () => {
      prisma.messages.findFirst.mockResolvedValue(null);
      await expect(service.listMessages(CONV, USER, 'does-not-exist')).resolves.toEqual([]);
      expect(prisma.messages.findMany).not.toHaveBeenCalled();
    });

    it('maps reactions and exposes file as null when there is none', async () => {
      prisma.messages.findMany.mockResolvedValue([
        messageRow({
          message_reactions: [
            { emoji: '👍', user_id: OTHER, users: { username: 'bob', display_name: 'Bob' } },
          ],
        }),
      ]);
      const [m] = await service.listMessages(CONV, USER);
      expect(m.file).toBeNull();
      expect(m.reactions).toEqual([
        { emoji: '👍', userId: OTHER, username: 'bob', displayName: 'Bob' },
      ]);
    });

    it('converts the bigint file size to a number', async () => {
      prisma.messages.findMany.mockResolvedValue([
        messageRow({
          files: [{
            id: 'f1', file_name: 'a.png', mime_type: 'image/png', size_bytes: 2048n,
            has_thumbnail: true, duration_secs: null, created_at: new Date('2026-08-01T10:00:00Z'),
          }],
        }),
      ]);
      const [m] = await service.listMessages(CONV, USER);
      // A bigint would throw on JSON.stringify when the response is serialised.
      expect(m.file).toMatchObject({ sizeBytes: 2048, fileName: 'a.png' });
      expect(typeof m.file!.sizeBytes).toBe('number');
      expect(() => JSON.stringify(m.file)).not.toThrow();
    });
  });

  // ── sendMessage ───────────────────────────────────────────────────────────────
  describe('sendMessage', () => {
    beforeEach(() => {
      asMember();
      prisma.messages.create.mockResolvedValue({ id: MSG });
      prisma.messages.findUniqueOrThrow.mockResolvedValue(messageRow());
      prisma.conversations.update.mockResolvedValue({});
    });

    it('stores the body as bytes and defaults the type to text', async () => {
      await service.sendMessage(CONV, USER, { ciphertext: 'hi' });
      const data = prisma.messages.create.mock.calls[0][0].data;
      expect(data.type).toBe('text');
      expect(Buffer.from(data.ciphertext).toString('utf8')).toBe('hi');
    });

    it('writes an empty body rather than null when no ciphertext is given', async () => {
      await service.sendMessage(CONV, USER, { type: 'image', fileId: undefined });
      const data = prisma.messages.create.mock.calls[0][0].data;
      expect(Buffer.from(data.ciphertext).toString('utf8')).toBe('');
    });

    it('bumps the conversation so it sorts to the top of the list', async () => {
      await service.sendMessage(CONV, USER, { ciphertext: 'hi' });
      expect(prisma.conversations.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CONV } }),
      );
    });

    it('only attaches a file the sender uploaded and that is not already attached', async () => {
      prisma.files.updateMany.mockResolvedValue({ count: 1 });
      await service.sendMessage(CONV, USER, { ciphertext: '', fileId: 'file-1' });
      // These two predicates are the whole access control on attachments.
      expect(prisma.files.updateMany).toHaveBeenCalledWith({
        where: { id: 'file-1', uploader_id: USER, message_id: null },
        data: { message_id: MSG },
      });
    });

    it('does not touch files when no fileId is supplied', async () => {
      await service.sendMessage(CONV, USER, { ciphertext: 'hi' });
      expect(prisma.files.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── edit / delete ─────────────────────────────────────────────────────────────
  describe('editMessage', () => {
    it('scopes the update to the sender and to messages that are not deleted', async () => {
      prisma.messages.updateMany.mockResolvedValue({ count: 1 });
      prisma.messages.findUniqueOrThrow.mockResolvedValue(messageRow({ edited_at: new Date() }));
      await service.editMessage(MSG, USER, 'new text');
      expect(prisma.messages.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MSG, sender_id: USER, deleted_at: null } }),
      );
    });

    it('rejects editing a message the user did not send', async () => {
      prisma.messages.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.editMessage(MSG, OTHER, 'nope')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deleteMessage', () => {
    const asAdmin = () => prisma.users.findUnique.mockResolvedValue({ role: 'admin' });
    const asStaff = () => prisma.users.findUnique.mockResolvedValue({ role: 'staff' });

    it('blanks the body rather than only flagging the row', async () => {
      asAdmin();
      prisma.messages.updateMany.mockResolvedValue({ count: 1 });
      prisma.messages.findUniqueOrThrow.mockResolvedValue({
        id: MSG, conversation_id: CONV, deleted_at: new Date(),
      });
      await service.deleteMessage(MSG, USER);
      const data = prisma.messages.updateMany.mock.calls[0][0].data;
      expect(Buffer.from(data.ciphertext)).toHaveLength(0);
      expect(data.deleted_at).toBeInstanceOf(Date);
    });

    // The whole point of an admin delete: the message is not theirs.
    it('lets an admin delete a message they did not send', async () => {
      asAdmin();
      prisma.messages.updateMany.mockResolvedValue({ count: 1 });
      prisma.messages.findUniqueOrThrow.mockResolvedValue({
        id: MSG, conversation_id: CONV, deleted_at: new Date(),
      });
      await service.deleteMessage(MSG, USER);
      expect(prisma.messages.updateMany.mock.calls[0][0].where).not.toHaveProperty('sender_id');
    });

    // Hiding the button does not close the HTTP route or the socket event.
    it('refuses a non-admin, and never touches the row', async () => {
      asStaff();
      await expect(service.deleteMessage(MSG, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a non-admin deleting their own message', async () => {
      asStaff();
      await expect(service.deleteMessage(MSG, USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.updateMany).not.toHaveBeenCalled();
    });

    // A deleted account's token can outlive the row it was issued for.
    it('refuses when the actor no longer exists', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      await expect(service.deleteMessage(MSG, USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.updateMany).not.toHaveBeenCalled();
    });

    it('404s on a message that is already deleted', async () => {
      asAdmin();
      prisma.messages.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteMessage(MSG, USER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── reactions ─────────────────────────────────────────────────────────────────
  describe('reactions', () => {
    it('is idempotent — reacting twice does not error or duplicate', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      asMember();
      prisma.message_reactions.upsert.mockResolvedValue({});
      await service.addReaction(MSG, USER, '👍');
      expect(prisma.message_reactions.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });

    it('will not react to a deleted message', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: new Date() });
      await expect(service.addReaction(MSG, USER, '👍')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes only this user\'s reaction of that emoji', async () => {
      prisma.message_reactions.deleteMany.mockResolvedValue({ count: 1 });
      await service.removeReaction(MSG, USER, '👍');
      expect(prisma.message_reactions.deleteMany).toHaveBeenCalledWith({
        where: { message_id: MSG, user_id: USER, emoji: '👍' },
      });
    });
  });

  // ── markRead ──────────────────────────────────────────────────────────────────
  describe('markRead', () => {
    it('updates only this user\'s membership row', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV });
      prisma.conversation_members.updateMany.mockResolvedValue({ count: 1 });
      await service.markRead(MSG, USER);
      expect(prisma.conversation_members.updateMany).toHaveBeenCalledWith({
        where: { conversation_id: CONV, user_id: USER },
        data: { last_read_message_id: MSG },
      });
    });

    it('is a no-op for an unknown message, as the SQL subquery was', async () => {
      prisma.messages.findUnique.mockResolvedValue(null);
      await expect(service.markRead('nope', USER)).resolves.toBeUndefined();
      expect(prisma.conversation_members.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── forwarding ────────────────────────────────────────────────────────────────
  describe('forwardMessage', () => {
    const original = {
      type: 'text', ciphertext: bytes('forward me'), sender_id: OTHER, conversation_id: 'source-conv',
      files: [] as Record<string, unknown>[],
    };

    /** The same message but carrying an attachment. */
    const originalWithFile = {
      ...original,
      type: 'image',
      files: [{
        uploader_id: OTHER, storage_key: 'abc.png', file_name: 'photo.png',
        mime_type: 'image/png', size_bytes: 1024n, has_thumbnail: true, duration_secs: null,
      }],
    };

    it('requires membership of both the source and the target conversation', async () => {
      prisma.messages.findUnique.mockResolvedValue(original);
      // member of source, not of target
      prisma.conversation_members.findUnique
        .mockResolvedValueOnce(MEMBER)
        .mockResolvedValueOnce(null);

      await expect(service.forwardMessage(MSG, USER, 'target-conv')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.create).not.toHaveBeenCalled();
    });

    it('rejects forwarding out of a conversation the user cannot read', async () => {
      prisma.messages.findUnique.mockResolvedValue(original);
      prisma.conversation_members.findUnique.mockResolvedValueOnce(null);
      await expect(service.forwardMessage(MSG, USER, 'target-conv')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messages.create).not.toHaveBeenCalled();
    });

    /** Shared setup for a forward that is allowed to go through. */
    const allowForward = () => {
      prisma.messages.findUnique.mockResolvedValue(original);
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.messages.create.mockResolvedValue({ id: 'new-msg' });
      prisma.conversations.update.mockResolvedValue({});
      prisma.messages.findUniqueOrThrow.mockResolvedValue(
        messageRow({
          id: 'new-msg',
          conversation_id: 'target-conv',
          sender_id: USER,
          forwarded_from_message_id: MSG,
          users_messages_original_sender_idTousers: { display_name: 'Bob' },
        }),
      );
    };

    it('preserves the original sender so attribution survives the forward', async () => {
      allowForward();
      await service.forwardMessage(MSG, USER, 'target-conv');

      const data = prisma.messages.create.mock.calls[0][0].data;
      expect(data.original_sender_id).toBe(OTHER);
      expect(data.forwarded_from_message_id).toBe(MSG);
      expect(data.sender_id).toBe(USER);
    });

    it('returns a full message, not just an id', async () => {
      allowForward();
      const out = await service.forwardMessage(MSG, USER, 'target-conv');
      // Returning only { id, conversationId } left the sender unable to render what they sent.
      for (const key of ['id', 'conversationId', 'senderId', 'type', 'ciphertext', 'createdAt']) {
        expect(out).toHaveProperty(key);
      }
      expect(out.conversationId).toBe('target-conv');
    });

    it('carries the original sender\'s name so the "Forwarded from" label can render', async () => {
      allowForward();
      const out = await service.forwardMessage(MSG, USER, 'target-conv');
      expect(out.forwardedFromDisplayName).toBe('Bob');
    });

    it('announces the message so the gateway can broadcast it', async () => {
      allowForward();
      const seen: unknown[] = [];
      service.events.on('message:new', (m) => seen.push(m));

      const out = await service.forwardMessage(MSG, USER, 'target-conv');

      // Without this the forward reached the database but nobody saw it until a reload.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(out);
    });

    it('does not announce anything when the forward is refused', async () => {
      prisma.messages.findUnique.mockResolvedValue(original);
      prisma.conversation_members.findUnique.mockResolvedValueOnce(null);
      const seen: unknown[] = [];
      service.events.on('message:new', (m) => seen.push(m));

      await expect(service.forwardMessage(MSG, USER, 'target-conv')).rejects.toBeInstanceOf(ForbiddenException);
      expect(seen).toHaveLength(0);
    });

    it('brings a copy of the attachment, so the forward is not an empty bubble', async () => {
      prisma.messages.findUnique.mockResolvedValue(originalWithFile);
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.messages.create.mockResolvedValue({ id: 'new-msg' });
      prisma.conversations.update.mockResolvedValue({});
      prisma.messages.findUniqueOrThrow.mockResolvedValue(messageRow({ id: 'new-msg' }));

      await service.forwardMessage(MSG, USER, 'target-conv');

      // files.message_id references exactly one message, so the row is copied rather than moved —
      // pointing at the same storage_key means no re-upload and the original keeps its own file.
      const data = prisma.messages.create.mock.calls[0][0].data;
      expect(data.files.createMany.data).toHaveLength(1);
      expect(data.files.createMany.data[0]).toMatchObject({
        storage_key: 'abc.png',
        file_name: 'photo.png',
        uploader_id: OTHER,
      });
    });

    it('does not attach an empty files block when the message has none', async () => {
      allowForward();
      await service.forwardMessage(MSG, USER, 'target-conv');
      expect(prisma.messages.create.mock.calls[0][0].data.files).toBeUndefined();
    });

    it('reports a missing source message as not found', async () => {
      prisma.messages.findUnique.mockResolvedValue(null);
      await expect(service.forwardMessage(MSG, USER, 'target-conv')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────
  describe('searchMessages', () => {
    it('escapes LIKE wildcards so they cannot widen the match', async () => {
      await service.searchMessages('100%_off', USER);
      const params = prisma.$queryRaw.mock.calls[0].slice(1);
      const pattern = params.find((p: unknown) => typeof p === 'string' && p.includes('off'));
      expect(pattern).toBe('%100!%!_off%');
    });

    it('passes the user id so the join restricts results to their conversations', async () => {
      await service.searchMessages('hello', USER);
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain(USER);
    });
  });

  // ── bookmarks / pins map through relations ────────────────────────────────────
  describe('listBookmarks', () => {
    it('decodes bodies and excludes messages whose sender was removed', async () => {
      prisma.user_bookmarks.findMany.mockResolvedValue([
        {
          message_id: MSG,
          created_at: new Date('2026-08-02T00:00:00Z'),
          messages: {
            type: 'text',
            ciphertext: bytes('saved'),
            users_messages_sender_idTousers: { display_name: 'Bob' },
          },
        },
      ]);
      const [b] = await service.listBookmarks(USER);
      expect(b).toMatchObject({ messageId: MSG, ciphertext: 'saved', senderDisplayName: 'Bob' });
      expect(prisma.user_bookmarks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ messages: { sender_id: { not: null } } }),
        }),
      );
    });

    it('filters by conversation only when one is given', async () => {
      prisma.user_bookmarks.findMany.mockResolvedValue([]);
      await service.listBookmarks(USER);
      expect(prisma.user_bookmarks.findMany.mock.calls[0][0].where).not.toHaveProperty('conversation_id');

      prisma.user_bookmarks.findMany.mockClear();
      await service.listBookmarks(USER, CONV);
      expect(prisma.user_bookmarks.findMany.mock.calls[0][0].where).toMatchObject({ conversation_id: CONV });
    });
  });
});
