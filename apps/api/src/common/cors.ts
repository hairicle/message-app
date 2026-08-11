/**
 * Which browser origins may call this API.
 *
 * Shared by the HTTP server and the Socket.IO gateway so the two cannot drift — they were
 * previously configured in different files and both ended up permitting everything.
 */

/**
 * Used when CORS_ORIGIN is unset, which in practice means a developer's machine.
 *
 * Defaulting to these rather than to everything is the point. An unset variable is far more often
 * a deployment that forgot it than a deliberate decision to accept any origin, and the failure it
 * produces should be a browser refusing one request with a legible message — not a service that
 * looks fine and quietly answers the whole internet.
 */
const DEVELOPMENT_ORIGINS = ['http://localhost:3100', 'http://localhost:3000'];

/**
 * Hosts that can only be reached from the machine or the local network.
 *
 * `localhost` and `127.0.0.1` are the same server and different origins, which is a browser rule
 * rather than a meaningful distinction; the private ranges cover the address `next dev` prints as
 * its Network URL, which is how anyone tests the app on a phone.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isLocalHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || PRIVATE_IPV4.test(hostname);
}

/**
 * Parses CORS_ORIGIN, which may name several origins separated by commas.
 *
 * A trailing slash is dropped: `https://app.example.com/` never matches, because the browser sends
 * an Origin header with no path at all, and the mismatch shows up as every request failing while
 * the API's own logs look healthy.
 */
export function allowedOrigins(value: string | undefined): string[] {
  const configured = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return configured.length > 0 ? configured : DEVELOPMENT_ORIGINS;
}

/**
 * Whether a request from `origin` may be answered.
 *
 * The configured list is matched exactly, in every environment. Outside production a local address
 * is also allowed, and that second rule exists because of a real regression: `CORS_ORIGIN` was set
 * to `http://localhost:3100`, the app was opened at `http://127.0.0.1:3100`, and every request from
 * the browser was refused — including sending a message. The two spell the same server, and no
 * developer should have to know which spelling the API was told about.
 *
 * It is switched off in production deliberately. There the deployment has a real hostname, so a
 * private-address origin is never a legitimate caller, and allowing one would be a finding with
 * nothing behind it.
 */
export function isOriginAllowed(
  origin: string | undefined,
  configured: string[],
  allowLocal: boolean,
): boolean {
  // No Origin header at all: a same-origin request, curl, a server-to-server call, or a health
  // check. CORS is a browser rule and there is no browser here to protect.
  if (!origin) return true;

  const normalised = origin.replace(/\/+$/, '');
  if (configured.includes(normalised)) return true;
  if (!allowLocal) return false;

  try {
    return isLocalHost(new URL(normalised).hostname);
  } catch {
    // Not a URL. Nothing legitimate sends that.
    return false;
  }
}

/**
 * Whether local addresses are additionally allowed.
 *
 * Read once, from the environment, so the HTTP server and the gateway cannot be given different
 * answers — the last time these two were configured separately they both drifted to allowing
 * everything.
 */
export const ALLOW_LOCAL_ORIGINS = process.env.NODE_ENV !== 'production';

/** The origin callback both the HTTP server and the socket gateway take. */
export type OriginMatcher = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void;

export function corsOriginMatcher(value: string | undefined, allowLocal: boolean): OriginMatcher {
  const configured = allowedOrigins(value);
  return (origin, callback) => {
    // `false` rather than an Error: a refused origin is a request the browser will block on its
    // own, and answering with a 500 would turn someone else's misconfiguration into our fault in
    // the logs.
    callback(null, isOriginAllowed(origin, configured, allowLocal));
  };
}
