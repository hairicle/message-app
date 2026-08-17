import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { createPrismaMock, MEMBER, type PrismaMock } from '../../testing/prisma-mock';

// Real UUIDs, because sendMessage now validates the shape of what it is given rather than trusting
// its declared type. Readable digits so a failure still says which one it was.
const CONV = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const MSG = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555';

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
      // Both keys. The timestamp alone is not unique — every row written in one transaction shares
      // one — so ordering by it left ties to the planner, and two runs of the same query could
      // disagree. The id makes the order total.
      expect(prisma.messages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] }),
      );
    });

    it('decodes the bytea body to text', async () => {
      prisma.messages.findMany.mockResolvedValue([messageRow({ ciphertext: bytes('សួស្តី 👋') })]);
      const [m] = await service.listMessages(CONV, USER);
      expect(m.ciphertext).toBe('សួស្តី 👋');
    });

    it('resolves `before` against the anchor message and scopes it to this conversation', async () => {
      const anchor = new Date('2026-08-01T09:00:00Z');
      prisma.messages.findFirst.mockResolvedValue({ created_at: anchor, id: 'anchor-id' });
      prisma.messages.findMany.mockResolvedValue([]);

      await service.listMessages(CONV, USER, 'anchor-id', 25);

      // Scoping by conversation_id stops an id from another conversation shifting the window.
      expect(prisma.messages.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'anchor-id', conversation_id: CONV } }),
      );
      // The cursor is the pair, not the timestamp. With `created_at < cutoff` alone, a message
      // sharing the boundary's timestamp was excluded from this page and every later one — a hole
      // in the scrollback that produced no error and nothing to see.
      expect(prisma.messages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversation_id: CONV,
            OR: [
              { created_at: { lt: anchor } },
              { created_at: anchor, id: { lt: 'anchor-id' } },
            ],
          },
          take: 25,
        }),
      );
    });

    // The anchor's own id is half the cursor, so selecting only its timestamp would silently
    // rebuild the bug this replaced.
    it('reads the anchor\'s id as well as its timestamp', async () => {
      prisma.messages.findFirst.mockResolvedValue({ created_at: new Date(), id: 'anchor-id' });
      prisma.messages.findMany.mockResolvedValue([]);
      await service.listMessages(CONV, USER, 'anchor-id');
      expect(prisma.messages.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ select: { created_at: true, id: true } }),
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
      prisma.files.findFirst.mockResolvedValue({ id: FILE });
      prisma.files.updateMany.mockResolvedValue({ count: 1 });
      await service.sendMessage(CONV, USER, { ciphertext: '', fileId: FILE });
      // These two predicates are the whole access control on attachments.
      expect(prisma.files.updateMany).toHaveBeenCalledWith({
        where: { id: FILE, uploader_id: USER, message_id: null },
        data: { message_id: MSG },
      });
    });

    it('does not touch files when no fileId is supplied', async () => {
      await service.sendMessage(CONV, USER, { ciphertext: 'hi' });
      expect(prisma.files.updateMany).not.toHaveBeenCalled();
    });

    // The previous order created the message and then updated nothing when the file did not match,
    // which answered 201 and left an image bubble with no image in it.
    it('refuses an attachment that does not exist, before writing the message', async () => {
      prisma.files.findFirst.mockResolvedValue(null);
      await expect(service.sendMessage(CONV, USER, { fileId: FILE, type: 'image' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.messages.create).not.toHaveBeenCalled();
    });

    describe('replies', () => {
      // A reply to a message that does not exist used to reach the foreign key and return 500.
      it('refuses a parent that does not exist', async () => {
        prisma.messages.findUnique.mockResolvedValue(null);
        await expect(service.sendMessage(CONV, USER, { ciphertext: 'hi', replyToMessageId: MSG }))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.messages.create).not.toHaveBeenCalled();
      });

      // Quoting across threads would surface the parent's text in a conversation it was not sent to.
      it('refuses a parent in another conversation', async () => {
        prisma.messages.findUnique.mockResolvedValue({ conversation_id: OTHER });
        await expect(service.sendMessage(CONV, USER, { ciphertext: 'hi', replyToMessageId: MSG }))
          .rejects.toBeInstanceOf(BadRequestException);
      });

      it('accepts a parent in this conversation', async () => {
        prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV });
        await service.sendMessage(CONV, USER, { ciphertext: 'hi', replyToMessageId: MSG });
        expect(prisma.messages.create.mock.calls[0][0].data.reply_to_message_id).toBe(MSG);
      });
    });

    describe('a retry of the same send', () => {
      const CLIENT_ID = '66666666-6666-4666-8666-666666666666';

      // The reason this exists: the client cannot tell "never received" from "saved, reply lost",
      // so it sends again — and without this the second attempt was a second message, permanently.
      it('returns the message already stored instead of writing another', async () => {
        prisma.messages.findFirst.mockResolvedValue(messageRow({ id: 'already-there' }));
        const out = await service.sendMessage(CONV, USER, { ciphertext: 'hi', clientMessageId: CLIENT_ID });
        expect(out.id).toBe('already-there');
        expect(prisma.messages.create).not.toHaveBeenCalled();
      });

      it('looks it up against the sender, not the conversation', async () => {
        prisma.messages.findFirst.mockResolvedValue(messageRow());
        await service.sendMessage(CONV, USER, { ciphertext: 'hi', clientMessageId: CLIENT_ID });
        expect(prisma.messages.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { sender_id: USER, client_message_id: CLIENT_ID } }),
        );
      });

      it('stores the id so the next attempt can find it', async () => {
        prisma.messages.findFirst.mockResolvedValue(null);
        await service.sendMessage(CONV, USER, { ciphertext: 'hi', clientMessageId: CLIENT_ID });
        expect(prisma.messages.create.mock.calls[0][0].data.client_message_id).toBe(CLIENT_ID);
      });

      // The lookup cannot close the race where both attempts are in flight at once — the unique
      // index decides it, and the loser has to read back what the winner wrote rather than fail.
      it('recovers the row the winner wrote when two attempts collide', async () => {
        prisma.messages.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(messageRow({ id: 'the-winner' }));
        prisma.messages.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        const out = await service.sendMessage(CONV, USER, { ciphertext: 'hi', clientMessageId: CLIENT_ID });
        expect(out.id).toBe('the-winner');
      });

      // Any other failure is still a failure; only a collision on this id means "already done".
      it('does not swallow an unrelated database error', async () => {
        prisma.messages.findFirst.mockResolvedValue(null);
        prisma.messages.create.mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'P1001' }));
        await expect(service.sendMessage(CONV, USER, { ciphertext: 'hi', clientMessageId: CLIENT_ID }))
          .rejects.toThrow('connection lost');
      });

      it('writes null when the client sends no id, as older builds do', async () => {
        await service.sendMessage(CONV, USER, { ciphertext: 'hi' });
        expect(prisma.messages.create.mock.calls[0][0].data.client_message_id).toBeNull();
        expect(prisma.messages.findFirst).not.toHaveBeenCalled();
      });
    });

    // The schema is enforced in the service, not the controller, because the socket gateway calls
    // this method directly — `message:send` would otherwise be unguarded.
    describe('rejects a malformed body from either transport', () => {
      for (const [label, body] of [
        ['an object where text belongs', { ciphertext: { $ne: null } }],
        ['a number where text belongs', { ciphertext: 42 }],
        ['an array where text belongs', { ciphertext: ['a', 'b'] }],
        ['a type the server reserves for itself', { ciphertext: 'hi', type: 'system' }],
        ['a type that does not exist', { ciphertext: 'hi', type: 'telepathy' }],
        ['an attachment id that is not a uuid', { fileId: 'file-1' }],
      ] as const) {
        it(label, async () => {
          await expect(service.sendMessage(CONV, USER, body)).rejects.toThrow();
          expect(prisma.messages.create).not.toHaveBeenCalled();
        });
      }
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
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      prisma.message_reactions.deleteMany.mockResolvedValue({ count: 1 });
      await service.removeReaction(MSG, USER, '👍');
      expect(prisma.message_reactions.deleteMany).toHaveBeenCalledWith({
        where: { message_id: MSG, user_id: USER, emoji: '👍' },
      });
    });

    // The bug these cover: the broadcast lived only in the socket handler, and the web client
    // reacts over HTTP — so reactions reached the database and no other screen.
    it('announces an added reaction with everything the client renders', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      asMember();
      prisma.message_reactions.upsert.mockResolvedValue({});
      prisma.users.findUnique.mockResolvedValue({ username: 'nini', display_name: 'Nini' });

      const seen: unknown[] = [];
      service.events.on('reaction:added', (p) => seen.push(p));
      await service.addReaction(MSG, USER, '👍');

      expect(seen).toEqual([{
        messageId: MSG, conversationId: CONV, userId: USER, emoji: '👍',
        username: 'nini', displayName: 'Nini',
      }]);
    });

    it('announces a removed reaction', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      prisma.message_reactions.deleteMany.mockResolvedValue({ count: 1 });

      const seen: unknown[] = [];
      service.events.on('reaction:removed', (p) => seen.push(p));
      await service.removeReaction(MSG, USER, '👍');

      expect(seen).toEqual([{ messageId: MSG, conversationId: CONV, userId: USER, emoji: '👍' }]);
    });

    // Otherwise a double tap tells every client to drop a reaction that is still there.
    it('stays silent when nothing was actually removed', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, deleted_at: null });
      prisma.message_reactions.deleteMany.mockResolvedValue({ count: 0 });

      const seen: unknown[] = [];
      service.events.on('reaction:removed', (p) => seen.push(p));
      await service.removeReaction(MSG, USER, '👍');

      expect(seen).toEqual([]);
    });
  });

  // ── markRead ──────────────────────────────────────────────────────────────────
  describe('markRead', () => {
    it('updates only this user\'s membership row', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, created_at: new Date() });
      prisma.conversation_members.findUnique.mockResolvedValue({ last_read_message_id: null });
      await service.markRead(MSG, USER);
      expect(prisma.conversation_members.update).toHaveBeenCalledWith({
        where: { conversation_id_user_id: { conversation_id: CONV, user_id: USER } },
        data: { last_read_message_id: MSG },
      });
    });

    it('is a no-op for an unknown message, as the SQL subquery was', async () => {
      prisma.messages.findUnique.mockResolvedValue(null);
      await expect(service.markRead('nope', USER)).resolves.toBeUndefined();
      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
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

  describe('sendMessage broadcast', () => {
    // The bug: only forwardMessage emitted, so a message sent over HTTP — the fallback whenever
    // the socket is down — was stored and delivered to nobody.
    it('announces the message it created', async () => {
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      prisma.messages.create.mockResolvedValue({ id: MSG });
      prisma.conversations.update.mockResolvedValue({});
      prisma.messages.findUniqueOrThrow.mockResolvedValue({
        id: MSG, conversation_id: CONV, sender_id: USER, type: 'text',
        ciphertext: Buffer.from('hi', 'utf8'), reply_to_message_id: null,
        created_at: new Date(), edited_at: null, deleted_at: null, files: [],
      });

      const seen: { id: string; conversationId: string }[] = [];
      service.events.on('message:new', (m) => seen.push(m));
      const returned = await service.sendMessage(CONV, USER, { ciphertext: 'hi' });

      expect(seen).toHaveLength(1);
      // The listener must receive the same shape the caller does, or a message renders
      // differently depending on which route delivered it.
      expect(seen[0]).toEqual(returned);
    });
  });

  describe('markRead', () => {
    const OLDER = new Date('2026-08-01T10:00:00Z');
    const NEWER = new Date('2026-08-01T11:00:00Z');
    const listen = () => { const seen: unknown[] = []; service.events.on('message:read', (p) => seen.push(p)); return seen; };

    it('advances the cutoff and announces it', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, created_at: NEWER });
      prisma.conversation_members.findUnique.mockResolvedValue({ last_read_message_id: null });
      const seen = listen();

      await service.markRead(MSG, USER);

      expect(prisma.conversation_members.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { last_read_message_id: MSG } }),
      );
      expect(seen).toEqual([{ messageId: MSG, conversationId: CONV, userId: USER, readAt: NEWER }]);
    });

    // The client marks what it can see and those arrive in no order; a blind write would move the
    // cutoff backwards and make already-read messages unread again.
    it('never moves the cutoff backwards', async () => {
      prisma.messages.findUnique
        .mockResolvedValueOnce({ conversation_id: CONV, created_at: OLDER })
        .mockResolvedValueOnce({ created_at: NEWER });
      prisma.conversation_members.findUnique.mockResolvedValue({ last_read_message_id: 'newer-msg' });
      const seen = listen();

      await service.markRead(MSG, USER);

      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
    });

    it('is silent when the cutoff is already this message', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, created_at: NEWER });
      prisma.conversation_members.findUnique.mockResolvedValue({ last_read_message_id: MSG });
      const seen = listen();

      await service.markRead(MSG, USER);

      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
    });

    it('ignores a non-member', async () => {
      prisma.messages.findUnique.mockResolvedValue({ conversation_id: CONV, created_at: NEWER });
      prisma.conversation_members.findUnique.mockResolvedValue(null);
      const seen = listen();

      await service.markRead(MSG, OTHER);

      expect(prisma.conversation_members.update).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
    });

    it('ignores an unknown message', async () => {
      prisma.messages.findUnique.mockResolvedValue(null);
      const seen = listen();
      await service.markRead(MSG, USER);
      expect(seen).toEqual([]);
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────
  describe('searchMessages', () => {
    /** A row as the current client writes it: base64 of UTF-8, stored as bytes. */
    const encoded = (text: string, over: Record<string, unknown> = {}) => ({
      id: MSG, conversation_id: CONV, sender_id: USER, type: 'text',
      ciphertext: Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8'),
      created_at: new Date(), edited_at: null, deleted_at: null, ...over,
    });
    /** A row from before the client encoded anything. */
    const plain = (text: string) => encoded('', { ciphertext: Buffer.from(text, 'utf8') });

    // The bug this replaces: matching ran against the stored base64, so the words a person
    // typed could never hit.
    it('finds a message by the text the user typed, not its encoding', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('zebracrossing at dawn')]);
      const results = await service.searchMessages('zebracrossing', USER);
      expect(results).toHaveLength(1);
    });

    it('still finds messages stored as plain text from before encoding', async () => {
      prisma.messages.findMany.mockResolvedValue([plain('legacy plaintext row')]);
      expect(await service.searchMessages('plaintext', USER)).toHaveLength(1);
    });

    it('matches case-insensitively', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('Quarterly Report')]);
      expect(await service.searchMessages('quarterly', USER)).toHaveLength(1);
    });

    it('matches non-ASCII text', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('អក្សរខ្មែរ and مرحبا')]);
      expect(await service.searchMessages('مرحبا', USER)).toHaveLength(1);
    });

    it('excludes messages that do not contain the query', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('nothing relevant here')]);
      expect(await service.searchMessages('zebracrossing', USER)).toEqual([]);
    });

    // Matching the encoding as well as the text would let a short query hit arbitrary
    // alphanumeric runs inside the base64 of messages that do not contain the word.
    it('does not match against the base64 the text is stored as', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('zebracrossing at dawn')]);
      const b64 = Buffer.from('zebracrossing at dawn', 'utf8').toString('base64').slice(0, 10);
      expect(await service.searchMessages(b64, USER)).toEqual([]);
    });

    it('returns ciphertext in its stored form, since the client decodes it', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('hello there')]);
      const [hit] = await service.searchMessages('hello', USER) as { ciphertext: string }[];
      expect(hit.ciphertext).toBe(Buffer.from('hello there', 'utf8').toString('base64'));
    });

    it('restricts the scan to conversations the caller belongs to', async () => {
      prisma.messages.findMany.mockResolvedValue([]);
      await service.searchMessages('hello', USER);
      const where = prisma.messages.findMany.mock.calls[0][0].where;
      expect(where.conversations.conversation_members.some.user_id).toBe(USER);
      expect(where.deleted_at).toBeNull();
    });

    it('scopes to one conversation when asked', async () => {
      prisma.messages.findMany.mockResolvedValue([]);
      await service.searchMessages('hello', USER, CONV);
      expect(prisma.messages.findMany.mock.calls[0][0].where.conversation_id).toBe(CONV);
    });

    it('does not query at all for an empty search', async () => {
      expect(await service.searchMessages('   ', USER)).toEqual([]);
      expect(prisma.messages.findMany).not.toHaveBeenCalled();
    });

    it('caps the number of results returned', async () => {
      prisma.messages.findMany.mockResolvedValue(
        Array.from({ length: 80 }, () => encoded('repeated match')),
      );
      expect(await service.searchMessages('repeated', USER)).toHaveLength(50);
    });

    // A query containing % or _ was previously escaped for LIKE; a substring test needs no
    // escaping, and these must now be treated as ordinary characters.
    it('treats LIKE wildcards as literal characters', async () => {
      prisma.messages.findMany.mockResolvedValue([encoded('100% off_today'), encoded('unrelated')]);
      expect(await service.searchMessages('100%_off', USER)).toEqual([]);
      expect(await service.searchMessages('100% off_today', USER)).toHaveLength(1);
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
