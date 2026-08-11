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
