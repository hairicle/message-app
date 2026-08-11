import { describe, it, expect } from 'vitest';
import { allowedOrigins } from './cors';

describe('allowedOrigins', () => {
  // The bug this replaces: enableCors() with no arguments reflected whatever Origin arrived, so a
  // live test got Access-Control-Allow-Origin: * back for evil.example.com.
  it('uses the configured origin', () => {
    expect(allowedOrigins('https://app.example.com')).toEqual(['https://app.example.com']);
  });

  it('accepts several, comma separated', () => {
    expect(allowedOrigins('https://a.example.com, https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  // A browser sends an Origin header with no path. A configured value carrying one never matches,
  // and the symptom is every request failing while the API's own logs look healthy.
  it('drops a trailing slash', () => {
    expect(allowedOrigins('https://app.example.com/')).toEqual(['https://app.example.com']);
  });

  it('drops several trailing slashes', () => {
    expect(allowedOrigins('https://app.example.com///')).toEqual(['https://app.example.com']);
  });

  it('ignores empty entries from a trailing comma', () => {
    expect(allowedOrigins('https://a.example.com,')).toEqual(['https://a.example.com']);
  });

  describe('when nothing is configured', () => {
    // Falling back to development origins rather than to everything: an unset variable is far more
    // often a deployment that forgot it than a decision to accept any origin.
    for (const value of [undefined, '', '   ', ',,']) {
      it(`falls back to localhost for ${JSON.stringify(value)}`, () => {
        const origins = allowedOrigins(value);
        expect(origins).toContain('http://localhost:3100');
        expect(origins.every((o) => o.startsWith('http://localhost'))).toBe(true);
      });
    }

    it('never returns a wildcard', () => {
      expect(allowedOrigins(undefined)).not.toContain('*');
    });
  });
});
