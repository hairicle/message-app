import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Where a login attempt names the account it is for. */
const LOGIN_PATHS = ['/api/auth/login', '/api/auth/login/totp'];

/**
 * The application's rate limiter.
 *
 * `ThrottlerModule` was configured but no guard was ever bound, so nothing counted requests and
 * the `@Throttle` decorators already sitting on the login routes never fired. A live test made
 * forty wrong-password attempts in thirty-one seconds without one of them being refused.
 *
 * Binding the stock guard would have fixed the counting and broken the product, because it counts
 * per address and this is an internal tool: everyone in the office reaches the API through one
 * address, so a single budget would be shared by the whole company and the busiest few minutes of
 * the morning would refuse everybody at once. What is counted therefore depends on what the
 * request is:
 *
 *   a signed-in request  → the bearer token it carries
 *   a login attempt      → the address and the account it names, together
 *   anything else        → the address
 *
 * Each of the three is the narrowest thing that identifies the caller at that point.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    // `req.ip` and not `req.ips[0]`: with `trust proxy` set to one hop, Express takes the address
    // the proxy observed, whereas the head of the forwarded chain is whatever the caller wrote
    // there. Reading the caller's own claim would let an attacker mint a fresh budget per request.
    const ip = (req.ip as string) ?? 'unknown';
    const path = String(req.url ?? '').split('?')[0];

    if (LOGIN_PATHS.includes(path)) {
      // Counted per account as well as per address. Guessing one person's password stays capped,
      // which is the thing worth stopping; colleagues signing in beside you no longer spend each
      // other's budget. Trying many accounts from one address is a different attack, and the
      // address half of this key is what limits it.
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
      return email ? `${ip}|${email}` : ip;
    }

    // The token rather than the user id, because this guard is global and therefore runs before
    // JwtAuthGuard has put a user on the request — there is nothing else here yet that identifies
    // the caller. Hashed so a bucket key is never a credential, and truncated because a rate
    // limiter needs a label, not a fingerprint.
    //
    // A forged token would be given its own budget, which sounds like an evasion and is not one:
    // every request carrying it is refused at the guard that runs next, before any query is made.
    const auth = (req.headers as Record<string, string> | undefined)?.authorization;
    if (auth?.startsWith('Bearer ')) {
      return `t:${createHash('sha256').update(auth.slice(7)).digest('base64url').slice(0, 24)}`;
    }

    return ip;
  }
}
