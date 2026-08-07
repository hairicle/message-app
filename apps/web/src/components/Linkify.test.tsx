import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Linkify } from './Linkify';

const html = (text: string) => renderToStaticMarkup(<Linkify text={text} />);

/** Entity-decode, so assertions read as the real attribute value rather than escaped markup. */
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

/** Every href in render order. */
const hrefs = (text: string) =>
  [...html(text).matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]));

/** Visible text with tags stripped — what the user actually reads. */
const visible = (text: string) => decode(html(text).replace(/<[^>]+>/g, ''));

describe('Linkify', () => {
  it('leaves plain text alone', () => {
    expect(html('just a message')).toBe('just a message');
  });

  it('links an http URL', () => {
    expect(hrefs('see https://example.com now')).toEqual(['https://example.com']);
  });

  it('prefixes bare www. links with https', () => {
    expect(hrefs('see www.example.com')).toEqual(['https://www.example.com']);
  });

  // The regression this guards: an earlier version called .test() on a /g regex, which
  // advances lastIndex between calls — so alternating messages silently failed to link.
  it('links every URL in a message, not just the first', () => {
    expect(hrefs('a https://one.com b https://two.com c www.three.com')).toEqual([
      'https://one.com',
      'https://two.com',
      'https://www.three.com',
    ]);
  });

  it('gives the same result when called repeatedly (no shared regex state)', () => {
    const text = 'go to https://example.com';
    expect(hrefs(text)).toEqual(hrefs(text));
    expect(hrefs(text)).toEqual(hrefs(text));
  });

  it('keeps the surrounding text intact', () => {
    expect(visible('check this out https://example.com ok'))
      .toBe('check this out https://example.com ok');
  });

  it('excludes trailing sentence punctuation from the link', () => {
    expect(hrefs('read https://example.com.')).toEqual(['https://example.com']);
    expect(hrefs('read https://example.com, then')).toEqual(['https://example.com']);
    expect(hrefs('(see https://example.com)')).toEqual(['https://example.com']);
  });

  it('still displays the trailing punctuation as text', () => {
    expect(visible('read https://example.com.')).toBe('read https://example.com.');
  });

  it('keeps meaningful path characters that are not trailing', () => {
    expect(hrefs('https://example.com/a,b/c?x=1&y=2'))
      .toEqual(['https://example.com/a,b/c?x=1&y=2']);
  });

  it('opens links in a new tab without leaking the referrer', () => {
    const out = html('https://example.com');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('wraps long URLs instead of overflowing the bubble', () => {
    // break-word, not break-all — break-all collapsed narrow bubbles to one character per line.
    const out = html('https://example.com/' + 'x'.repeat(120));
    expect(out).toMatch(/overflow-wrap:\s*break-word/);
    expect(out).not.toMatch(/word-break:\s*break-all/);
  });

  it('handles a URL at the very start and very end', () => {
    expect(hrefs('https://start.com middle')).toEqual(['https://start.com']);
    expect(hrefs('middle https://end.com')).toEqual(['https://end.com']);
  });

  it('escapes HTML in the surrounding text', () => {
    expect(html('<script>alert(1)</script> https://example.com'))
      .not.toContain('<script>');
  });

  it('handles an empty string', () => {
    expect(html('')).toBe('');
  });
});
