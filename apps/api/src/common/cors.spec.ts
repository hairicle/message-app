import { describe, it, expect } from 'vitest';
import { allowedOrigins, corsOriginMatcher, isOriginAllowed } from './cors';

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

  it('ignores empty entries from a trailing comma', () => {
    expect(allowedOrigins('https://a.example.com,')).toEqual(['https://a.example.com']);
  });

  describe('when nothing is configured', () => {
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

describe('isOriginAllowed', () => {
  const CONFIGURED = ['https://app.example.com'];

  it('allows exactly what was configured', () => {
    expect(isOriginAllowed('https://app.example.com', CONFIGURED, false)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isOriginAllowed('https://evil.example.com', CONFIGURED, false)).toBe(false);
  });

  it('tolerates a trailing slash on the request', () => {
    expect(isOriginAllowed('https://app.example.com/', CONFIGURED, false)).toBe(true);
  });

  // curl, a server-to-server call, a health check, or a same-origin request. CORS is a browser
  // rule and there is no browser here to protect.
  it('allows a request with no Origin at all', () => {
    expect(isOriginAllowed(undefined, CONFIGURED, false)).toBe(true);
  });

  describe('outside production', () => {
    // The regression that prompted this. CORS_ORIGIN said http://localhost:3100, the app was
    // opened at http://127.0.0.1:3100, and every request from the browser was refused — including
    // sending a message. The two spell the same server.
    for (const origin of [
      'http://127.0.0.1:3100',
      'http://localhost:3100',
      'http://[::1]:3100',
      'http://192.168.1.42:3100',
      'http://172.23.0.1:3100',
      'http://10.0.0.5:3000',
    ]) {
      it(`allows ${origin}`, () => {
        expect(isOriginAllowed(origin, CONFIGURED, true)).toBe(true);
      });
    }

    it('still refuses a public host that was not configured', () => {
      expect(isOriginAllowed('https://evil.example.com', CONFIGURED, true)).toBe(false);
    });

    // 172.32 is outside the private range; a public address that merely looks similar must not slip
    // through the pattern.
    it('refuses a public address near the private range', () => {
      expect(isOriginAllowed('http://172.32.0.1:3100', CONFIGURED, true)).toBe(false);
      expect(isOriginAllowed('http://11.0.0.1:3100', CONFIGURED, true)).toBe(false);
    });

    it('refuses something that is not a URL', () => {
      expect(isOriginAllowed('not a url', CONFIGURED, true)).toBe(false);
    });
  });

  describe('in production', () => {
    // There the deployment has a real hostname, so a private-address origin is never a legitimate
    // caller and allowing one would be a finding with nothing behind it.
    for (const origin of ['http://127.0.0.1:3100', 'http://192.168.1.42:3100', 'http://localhost:3100']) {
      it(`refuses ${origin} when it is not configured`, () => {
        expect(isOriginAllowed(origin, CONFIGURED, false)).toBe(false);
      });
    }

    it('allows a local origin that was configured explicitly', () => {
      expect(isOriginAllowed('http://localhost:3100', ['http://localhost:3100'], false)).toBe(true);
    });
  });
});

describe('corsOriginMatcher', () => {
  const decide = (matcher: ReturnType<typeof corsOriginMatcher>, origin?: string) =>
    new Promise<boolean | undefined>((resolve) => matcher(origin, (_err, allow) => resolve(allow)));

  it('answers true for a configured origin', async () => {
    const matcher = corsOriginMatcher('https://app.example.com', false);
    await expect(decide(matcher, 'https://app.example.com')).resolves.toBe(true);
  });

  // false rather than an Error: a refused origin is a request the browser blocks on its own, and
  // answering with a 500 would turn someone else's misconfiguration into our fault in the logs.
  it('answers false rather than raising for a refused one', async () => {
    const matcher = corsOriginMatcher('https://app.example.com', false);
    await expect(decide(matcher, 'https://evil.example.com')).resolves.toBe(false);
  });

  it('answers true for a local address in development', async () => {
    const matcher = corsOriginMatcher('http://localhost:3100', true);
    await expect(decide(matcher, 'http://127.0.0.1:3100')).resolves.toBe(true);
  });
});
