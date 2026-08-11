import { describe, it, expect, beforeEach } from 'vitest';
import { AppThrottlerGuard } from './throttler.guard';

/** getTracker is protected; the tests exercise it as the guard's behaviour, not its API. */
type Trackable = { getTracker(req: Record<string, unknown>): Promise<string> };

describe('AppThrottlerGuard', () => {
  let guard: Trackable;

  beforeEach(() => {
    guard = Object.create(AppThrottlerGuard.prototype) as Trackable;
  });

  const track = (req: Record<string, unknown>) => guard.getTracker(req);

  it('counts an unauthenticated request against its address', async () => {
    expect(await track({ ip: '203.0.113.7', url: '/api/health' })).toBe('203.0.113.7');
  });

  describe('a signed-in request', () => {
    const withToken = (token: string, ip = '198.51.100.4') =>
      track({ ip, url: '/api/messages', headers: { authorization: `Bearer ${token}` } });

    // The reason this guard exists. This is an internal tool: the whole company reaches the API
    // through one office address, so counting per address would give everybody one shared budget
    // and refuse them all together on the busiest morning.
    it('is counted per caller, not per address', async () => {
      expect(await withToken('token-for-ann')).not.toBe(await withToken('token-for-ben'));
    });

    it('gives the same caller the same bucket', async () => {
      expect(await withToken('token-for-ann')).toBe(await withToken('token-for-ann'));
    });

    // Two people at home, on different addresses, are still two callers — and one person moving
    // between office and home should not get a fresh budget by doing so.
    it('does not change when the address does', async () => {
      expect(await withToken('token-for-ann', '198.51.100.4'))
        .toBe(await withToken('token-for-ann', '203.0.113.9'));
    });

    // A bucket key ends up in storage and in logs; it must not be usable as a credential.
    it('never puts the token itself in the key', async () => {
      const key = await withToken('super-secret-token');
      expect(key).not.toContain('super-secret-token');
      expect(key.length).toBeLessThan(40);
    });

    it('falls back to the address when the header is not a bearer token', async () => {
      const key = await track({
        ip: '203.0.113.7', url: '/api/messages', headers: { authorization: 'Basic abc' },
      });
      expect(key).toBe('203.0.113.7');
    });
  });

  describe('a login', () => {
    // The reason this guard exists. Everyone in an office shares one address, so a per-address
    // budget of ten logins per quarter hour is ten sign-ins for the whole company — the eleventh
    // person to arrive would be refused for suspicious activity.
    it('is counted per account as well as per address', async () => {
      const a = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: 'ann@x.com' } });
      const b = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: 'ben@x.com' } });
      expect(a).not.toBe(b);
    });

    it('gives the same person the same bucket', async () => {
      const one = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: 'ann@x.com' } });
      const two = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: 'ann@x.com' } });
      expect(one).toBe(two);
    });

    // Otherwise capitalisation alone would mint a fresh budget for every attempt.
    it('is not fooled by case or padding', async () => {
      const plain = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: 'ann@x.com' } });
      const noisy = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: '  ANN@X.com ' } });
      expect(noisy).toBe(plain);
    });

    // A different address guessing the same account must not inherit its remaining budget.
    it('still separates addresses', async () => {
      const here = await track({ ip: '198.51.100.4', url: '/api/auth/login', body: { email: 'ann@x.com' } });
      const there = await track({ ip: '203.0.113.9', url: '/api/auth/login', body: { email: 'ann@x.com' } });
      expect(here).not.toBe(there);
    });

    it('covers the second step of two-factor sign-in', async () => {
      const withEmail = await track({ ip: '198.51.100.4', url: '/api/auth/login/totp', body: { email: 'ann@x.com' } });
      expect(withEmail).toContain('ann@x.com');
    });

    it('ignores a query string when matching the path', async () => {
      const t = await track({ ip: '198.51.100.4', url: '/api/auth/login?next=/chat', body: { email: 'ann@x.com' } });
      expect(t).toBe('198.51.100.4|ann@x.com');
    });

    // A body with no usable email must not widen the bucket to something shared or unbounded.
    for (const [label, body] of [
      ['no body', undefined],
      ['no email', {}],
      ['a non-string email', { email: { $ne: null } }],
      ['a blank email', { email: '   ' }],
    ] as const) {
      it(`falls back to the address alone with ${label}`, async () => {
        expect(await track({ ip: '198.51.100.4', url: '/api/auth/login', body })).toBe('198.51.100.4');
      });
    }
  });

  // Every unknown caller sharing one bucket would let any of them exhaust it for the rest.
  it('does not collapse unknown addresses onto a shared bucket by accident', async () => {
    const missing = await track({ url: '/api/messages' });
    expect(missing).toBe('unknown');
  });
});
