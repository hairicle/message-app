import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as path from 'path';

const MAX_BYTES = 5 * 1024 * 1024;

/** Only formats a browser will reliably render inline — an avatar is never downloaded. */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Uploads avatar images to the private avatars bucket.
 *
 * Shared because both a user and a conversation can have one, and the alternative was a second
 * copy of the bucket name, the service-key header and the upsert semantics — three things that
 * must not drift apart, since getting any of them wrong writes to the wrong place or writes
 * something unauthenticated.
 */
@Injectable()
export class AvatarStorageService {
  constructor(private readonly config: ConfigService) {}

  private get storageBase(): string {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT') ?? '';
    return endpoint.replace(/\/storage\/v1\/s3\/?$/, '');
  }

  private get bucket(): string {
    return this.config.get<string>('AVATAR_BUCKET') ?? 'avatars';
  }

  private headers(): Record<string, string> {
    const key = this.config.get<string>('SUPABASE_SERVICE_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  /**
   * Stores the image under `prefix/uuid.ext` and returns the object key.
   *
   * The key is what callers persist, never a URL: the bucket is private, so the response layer
   * signs it per request with a short-lived token.
   */
  async upload(prefix: string, file: Express.Multer.File): Promise<string> {
    if (file.size > MAX_BYTES) throw new BadRequestException('Avatar too large (max 5 MB)');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Avatar must be a JPEG, PNG, WebP or GIF image');
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const storageKey = `${prefix}/${randomUUID()}${ext}`;

    const res = await fetch(`${this.storageBase}/storage/v1/object/${this.bucket}/${storageKey}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': file.mimetype, 'x-upsert': 'true' },
      body: new Uint8Array(file.buffer),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => 'storage error');
      throw new BadRequestException(`Avatar upload failed: ${msg}`);
    }

    return storageKey;
  }
}
