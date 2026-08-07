import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Cached signature: the URL plus the moment we stop trusting it. */
interface Signed {
  url: string;
  refreshAfter: number;
}

const TTL_SECONDS = 3600;
// Re-sign well before expiry so a URL handed to a browser is never nearly stale.
const REFRESH_AFTER_MS = (TTL_SECONDS - 600) * 1000;

/**
 * Turns a stored avatar reference into a short-lived signed URL.
 *
 * Avatars used to live in a public bucket and were emitted as permanent
 * `/object/public/...` links, so anyone who ever saw one kept access to that person's photo
 * indefinitely. Signing is cached because avatars change rarely but are read constantly — a
 * directory listing or conversation list asks for dozens at once.
 */
@Injectable()
export class AvatarUrlService {
  private readonly logger = new Logger(AvatarUrlService.name);
  private readonly cache = new Map<string, Signed>();

  constructor(private readonly config: ConfigService) {}

  private get storageBase(): string {
    return (this.config.get<string>('STORAGE_ENDPOINT') ?? '').replace(/\/storage\/v1\/s3\/?$/, '');
  }

  private get bucket(): string {
    return this.config.get<string>('AVATAR_BUCKET') ?? 'avatars';
  }

  /**
   * Stored values come in two shapes: rows written before this change hold a full public URL,
   * newer ones hold just the object key. Accept both so no data migration is required.
   */
  private toKey(stored: string): string | null {
    if (!stored) return null;
    // A leading slash means an app route, not an object key — one row still holds the old
    // Express-era "/api/users/:id/avatar" path, whose endpoint no longer exists. Signing it would
    // 404 on every request that returns that user.
    if (stored.startsWith('/')) return null;
    if (!/^https?:\/\//i.test(stored)) return stored;
    const marker = `/${this.bucket}/`;
    const at = stored.indexOf(marker);
    if (at === -1) return null; // an external URL we do not own — leave it alone
    return stored.slice(at + marker.length).split('?')[0];
  }

  /** Signed URL for a stored avatar reference, or the original value if it cannot be signed. */
  async resolve(stored: string): Promise<string> {
    const key = this.toKey(stored);
    if (!key) return stored;

    const hit = this.cache.get(key);
    if (hit && hit.refreshAfter > Date.now()) return hit.url;

    const serviceKey = this.config.get<string>('SUPABASE_SERVICE_KEY');
    try {
      const res = await fetch(`${this.storageBase}/storage/v1/object/sign/${this.bucket}/${key}`, {
        method: 'POST',
        headers: {
          ...(serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: TTL_SECONDS }),
      });
      if (!res.ok) {
        // Missing object or storage hiccup: fall back to the stored value rather than blanking
        // every avatar in the response.
        return stored;
      }
      const { signedURL } = (await res.json()) as { signedURL: string };
      const url = `${this.storageBase}/storage/v1${signedURL}`;
      this.cache.set(key, { url, refreshAfter: Date.now() + REFRESH_AFTER_MS });
      return url;
    } catch (err) {
      this.logger.warn(`Could not sign avatar ${key}: ${(err as Error).message}`);
      return stored;
    }
  }

  /** Drop a cached signature — used after a user replaces their photo. */
  invalidate(stored: string | null) {
    const key = stored ? this.toKey(stored) : null;
    if (key) this.cache.delete(key);
  }
}
