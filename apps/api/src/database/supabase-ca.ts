import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Supabase's connection poolers present a chain rooted at "Supabase Root 2021 CA", a private root
 * that is not in any system trust store. Without it, TLS verification fails with
 * SELF_SIGNED_CERT_IN_CHAIN — which is why this connection previously ran with
 * `rejectUnauthorized: false`, giving encryption but no proof of who was on the other end.
 *
 * The certificate in certs/ was downloaded from Supabase over a publicly-validated HTTPS channel
 * and its SHA-256 fingerprint checked against the root the pooler actually chains to:
 *
 *   80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 *
 * It is a public certificate, not a secret. It expires 2031-04-26.
 */
const CA_FILENAME = 'supabase-prod-ca-2021.crt';

// Resolved relative to this file so it works from src/ under ts-node and from dist/ after a build,
// where nest copies assets alongside the compiled output. __dirname is guarded because a script
// run as an ES module has no such binding, and referencing it there throws rather than being
// undefined — which would take the whole helper down instead of falling through to the paths
// below, which cover that case.
const CANDIDATES = [
  ...(typeof __dirname !== 'undefined' ? [join(__dirname, '..', '..', 'certs', CA_FILENAME)] : []),
  join(process.cwd(), 'certs', CA_FILENAME),
  join(process.cwd(), 'apps', 'api', 'certs', CA_FILENAME),
];

let cached: string | null = null;

/** PEM for the Supabase root CA, or null if it cannot be located. */
export function supabaseRootCa(): string | null {
  if (cached !== null) return cached;
  for (const path of CANDIDATES) {
    try {
      cached = readFileSync(path, 'utf8');
      return cached;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
