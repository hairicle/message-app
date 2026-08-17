import { describe, it, expect, vi, afterEach } from 'vitest';
import { newClientMessageId } from './clientMessageId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('newClientMessageId', () => {
  it('produces a valid version-4 uuid', () => {
    expect(newClientMessageId()).toMatch(UUID_V4);
  });

  // The server validates it as a uuid, so a malformed one is refused at send time.
  it('produces a new one every call', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newClientMessageId()));
    expect(seen.size).toBe(200);
  });

  describe('without crypto.randomUUID', () => {
    // A page served over plain HTTP from a LAN address has no secure context — which is exactly
    // how someone tests on a phone, and where throwing would break sending entirely.
    it('still produces a valid uuid', () => {
      vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i += 1) a[i] = i * 7 % 256; return a; } });
      expect(newClientMessageId()).toMatch(UUID_V4);
    });

    it('still produces a valid uuid with no crypto at all', () => {
      vi.stubGlobal('crypto', undefined);
      expect(newClientMessageId()).toMatch(UUID_V4);
      expect(new Set(Array.from({ length: 50 }, () => newClientMessageId())).size).toBe(50);
    });
  });
});
