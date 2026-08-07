import { describe, it, expect } from 'vitest';
import { encodeMessageText, decodeMessageText } from './text';

describe('message text encoding', () => {
  it('round-trips plain ASCII', () => {
    expect(decodeMessageText(encodeMessageText('hello world'))).toBe('hello world');
  });

  it('round-trips non-Latin scripts', () => {
    // The app is used in Khmer and Chinese; btoa alone would throw on these, which is why
    // the implementation wraps it in encodeURIComponent/unescape.
    for (const text of ['សួស្តី', '海辣 Hotpot', 'Ancle Hai 小海叔']) {
      expect(decodeMessageText(encodeMessageText(text))).toBe(text);
    }
  });

  it('round-trips emoji (surrogate pairs)', () => {
    expect(decodeMessageText(encodeMessageText('nice 👍🔥'))).toBe('nice 👍🔥');
  });

  it('round-trips newlines and punctuation', () => {
    const text = 'line one\nline two\t— "quoted" & <tagged>';
    expect(decodeMessageText(encodeMessageText(text))).toBe(text);
  });

  it('returns empty string for empty input rather than throwing', () => {
    expect(decodeMessageText('')).toBe('');
    expect(decodeMessageText(encodeMessageText(''))).toBe('');
  });

  it('passes through pre-encoding plaintext unchanged', () => {
    // Messages stored before base64 encoding was introduced must still render.
    // 'hello world!' is not valid base64, so decode falls back to the raw string.
    expect(decodeMessageText('hello world!')).toBe('hello world!');
  });

  it('passes through text that would decode to mojibake', () => {
    const legacy = 'Automated test message';
    expect(decodeMessageText(legacy)).toBe(legacy);
  });
});
