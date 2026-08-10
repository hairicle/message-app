import { describe, it, expect } from 'vitest';
import { extractMentions, mentions, segmentMentions } from './mentions';

const KNOWN = ['nini', 'dara', 'admin'];

describe('extractMentions', () => {
  it('finds a mention', () => {
    expect(extractMentions('hey @nini can you look')).toEqual(['nini']);
  });

  it('finds several', () => {
    expect(extractMentions('@nini @dara please review')).toEqual(['nini', 'dara']);
  });

  it('does not repeat one mentioned twice', () => {
    expect(extractMentions('@nini and again @nini')).toEqual(['nini']);
  });

  it('lowercases, so capitalisation cannot cause a miss', () => {
    expect(extractMentions('@NiNi')).toEqual(['nini']);
  });

  it('reads a mention at the very start', () => {
    expect(extractMentions('@nini hello')).toEqual(['nini']);
  });

  // The one that would quietly notify the wrong people.
  it('does not treat an email address as a mention', () => {
    expect(extractMentions('write to dara@example.com about it')).toEqual([]);
  });

  it('ignores a bare @', () => {
    expect(extractMentions('meet @ 5pm')).toEqual([]);
  });

  it('stops at punctuation after the name', () => {
    expect(extractMentions('thanks @dara!')).toEqual(['dara']);
  });

  it('keeps dots, dashes and underscores that are part of a username', () => {
    expect(extractMentions('@dara.k @nini-b @admin_1')).toEqual(['dara.k', 'nini-b', 'admin_1']);
  });

  it('finds nothing in text with no mentions', () => {
    expect(extractMentions('just a normal message')).toEqual([]);
  });
});

describe('mentions', () => {
  it('is true when the person is mentioned', () => {
    expect(mentions('ping @nini', 'nini')).toBe(true);
  });

  it('ignores case in both directions', () => {
    expect(mentions('ping @NINI', 'nini')).toBe(true);
    expect(mentions('ping @nini', 'NiNi')).toBe(true);
  });

  it('is false when someone else is mentioned', () => {
    expect(mentions('ping @dara', 'nini')).toBe(false);
  });

  // A prefix must not count, or "@ni" would notify "nini".
  it('does not match a partial name', () => {
    expect(mentions('ping @ni', 'nini')).toBe(false);
  });

  it('is false when there is no username to compare', () => {
    expect(mentions('ping @nini', undefined)).toBe(false);
  });
});

describe('segmentMentions', () => {
  const kinds = (text: string) => segmentMentions(text, KNOWN).map((s) => s.kind);

  it('splits text around a mention', () => {
    expect(segmentMentions('hey @nini ok', KNOWN)).toEqual([
      { kind: 'text', value: 'hey ' },
      { kind: 'mention', value: '@nini', username: 'nini', known: true },
      { kind: 'text', value: ' ok' },
    ]);
  });

  it('handles a mention at the start with no leading text', () => {
    expect(kinds('@nini hello')).toEqual(['mention', 'text']);
  });

  it('handles a mention at the very end', () => {
    expect(kinds('goodbye @dara')).toEqual(['text', 'mention']);
  });

  it('marks someone not in the conversation as unknown', () => {
    const [, mention] = segmentMentions('lunch at @noodles today', KNOWN);
    expect(mention).toMatchObject({ kind: 'mention', username: 'noodles', known: false });
  });

  it('leaves an email address as plain text', () => {
    expect(segmentMentions('mail dara@example.com', KNOWN)).toEqual([
      { kind: 'text', value: 'mail dara@example.com' },
    ]);
  });

  it('reassembles into exactly the original text', () => {
    for (const text of [
      'hey @nini and @dara',
      '@nini',
      'no mentions here',
      'mail dara@example.com please',
      'thanks @dara!',
      '@nini@dara',
    ]) {
      expect(segmentMentions(text, KNOWN).map((s) => s.value).join('')).toBe(text);
    }
  });

  it('returns nothing for empty text', () => {
    expect(segmentMentions('', KNOWN)).toEqual([]);
  });
});
