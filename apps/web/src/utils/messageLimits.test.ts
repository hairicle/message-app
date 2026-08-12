import { describe, it, expect } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  charCount,
  isOverMessageLimit,
  messageLengthHint,
} from './messageLimits';

describe('charCount', () => {
  it('counts plain characters', () => {
    expect(charCount('hello')).toBe(5);
  });

  // String.length counts UTF-16 units, so an emoji reads as two and a flag as four. Someone
  // pasting emoji would watch the counter fall twice as fast as the text they can see.
  it('counts an emoji as one', () => {
    expect(charCount('👋')).toBe(1);
    expect(charCount('a👋b')).toBe(3);
  });

  it('counts non-Latin script by character', () => {
    expect(charCount('សួស្តី')).toBe('សួស្តី'.length);
  });
});

describe('isOverMessageLimit', () => {
  it('accepts an ordinary message', () => {
    expect(isOverMessageLimit('good morning')).toBe(false);
  });

  it('accepts a message of exactly the limit', () => {
    expect(isOverMessageLimit('x'.repeat(MAX_MESSAGE_CHARS))).toBe(false);
  });

  it('refuses one character over', () => {
    expect(isOverMessageLimit('x'.repeat(MAX_MESSAGE_CHARS + 1))).toBe(true);
  });

  it('accepts an empty message, which the send button handles separately', () => {
    expect(isOverMessageLimit('')).toBe(false);
  });
});

describe('messageLengthHint', () => {
  // A counter that is always on is a counter nobody reads.
  it('says nothing about a short message', () => {
    expect(messageLengthHint('hello')).toBeNull();
  });

  it('says nothing until the message is nearly at the limit', () => {
    expect(messageLengthHint('x'.repeat(Math.floor(MAX_MESSAGE_CHARS * 0.5)))).toBeNull();
  });

  it('counts down as the limit approaches', () => {
    const hint = messageLengthHint('x'.repeat(MAX_MESSAGE_CHARS - 100));
    expect(hint).not.toBeNull();
    expect(hint!.over).toBe(false);
    expect(hint!.label).toContain('100');
    expect(hint!.label).toContain('left');
  });

  it('says how far over it is once past', () => {
    const hint = messageLengthHint('x'.repeat(MAX_MESSAGE_CHARS + 250));
    expect(hint!.over).toBe(true);
    expect(hint!.label).toContain('250');
    expect(hint!.label).toContain('over');
  });

  // Four figures without a separator is a number people misread by an order of magnitude.
  it('groups the digits of a large count', () => {
    const hint = messageLengthHint('x'.repeat(MAX_MESSAGE_CHARS + 1500));
    expect(hint!.label).toMatch(/1[.,\s]500/);
  });
});
