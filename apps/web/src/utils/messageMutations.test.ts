import { describe, it, expect } from 'vitest';
import { applyDeletion, applyEdit } from './messageMutations';

/** The thread's shape: identified by `id`, carries the extra fields a full message has. */
const message = (id: string, text = 'hello') => ({
  id,
  ciphertext: text,
  editedAt: null as string | null,
  deletedAt: null as string | null,
  file: { id: 'f1' } as unknown,
});

/** The pinned bar and bookmarks: identified by `messageId`, and no editedAt or file. */
const pinned = (messageId: string, text = 'hello') => ({
  messageId,
  ciphertext: text,
  pinnedAt: '2026-08-01T10:00:00Z',
});

describe('applyEdit', () => {
  it('replaces the text of the message it names', () => {
    const [out] = applyEdit([message('a')], 'a', 'corrected', '2026-08-01T11:00:00Z');
    expect(out.ciphertext).toBe('corrected');
    expect(out.editedAt).toBe('2026-08-01T11:00:00Z');
  });

  it('leaves every other message alone', () => {
    const out = applyEdit([message('a', 'one'), message('b', 'two')], 'a', 'changed', null);
    expect(out[1].ciphertext).toBe('two');
  });

  // The pinned and bookmark rows identify themselves differently, which is the whole reason a
  // shared helper is worth having rather than two copies of the same map.
  it('matches on messageId as well as id', () => {
    const [out] = applyEdit([pinned('a')], 'a', 'corrected', null);
    expect(out.ciphertext).toBe('corrected');
  });

  // Inventing the field would put a property in state that nothing reads and no refetch reproduces.
  it('does not add editedAt to a shape that has none', () => {
    const [out] = applyEdit([pinned('a')], 'a', 'corrected', '2026-08-01T11:00:00Z');
    expect('editedAt' in out).toBe(false);
  });

  // React re-renders on a new array identity, so returning one when nothing changed is wasted work.
  it('returns the same array when nothing matched', () => {
    const items = [message('a')];
    expect(applyEdit(items, 'nope', 'x', null)).toBe(items);
  });

  it('copes with an empty list', () => {
    expect(applyEdit([], 'a', 'x', null)).toEqual([]);
  });
});

describe('applyDeletion', () => {
  // The bug this exists for: deleting a pinned message left its text readable in the pinned bar,
  // while the deletion reported success.
  it('blanks the text', () => {
    const [out] = applyDeletion([message('a', 'the secret')], 'a', '2026-08-01T11:00:00Z');
    expect(out.ciphertext).toBe('');
  });

  it('blanks it in the pinned shape too', () => {
    const [out] = applyDeletion([pinned('a', 'the secret')], 'a', null);
    expect(out.ciphertext).toBe('');
  });

  // A deleted image message that kept its file would still render the picture.
  it('drops the attachment', () => {
    const [out] = applyDeletion([message('a')], 'a', null);
    expect(out.file).toBeUndefined();
  });

  it('records when it was deleted, where the shape has room for it', () => {
    const [out] = applyDeletion([message('a')], 'a', '2026-08-01T11:00:00Z');
    expect(out.deletedAt).toBe('2026-08-01T11:00:00Z');
  });

  it('does not add deletedAt to a shape that has none', () => {
    const [out] = applyDeletion([pinned('a')], 'a', '2026-08-01T11:00:00Z');
    expect('deletedAt' in out).toBe(false);
  });

  // Blanked rather than removed, because that is what the server does — it writes an empty body and
  // leaves the row, and the pin and bookmark queries do not filter deleted messages out. Dropping
  // the entry would look tidier and disagree with the next refetch.
  it('keeps the entry rather than removing it', () => {
    expect(applyDeletion([pinned('a'), pinned('b')], 'a', null)).toHaveLength(2);
  });

  it('leaves every other message alone', () => {
    const out = applyDeletion([message('a', 'one'), message('b', 'two')], 'a', null);
    expect(out[1].ciphertext).toBe('two');
  });

  it('returns the same array when nothing matched', () => {
    const items = [message('a')];
    expect(applyDeletion(items, 'nope', null)).toBe(items);
  });
});
