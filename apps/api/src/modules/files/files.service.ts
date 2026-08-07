import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { randomUUID } from 'crypto';
import * as path from 'path';

interface FileRow {
  id: string; file_name: string; mime_type: string; size_bytes: number;
  has_thumbnail: boolean; duration_secs: number | null; created_at: string;
  uploader_id: string | null; conversation_id: string | null;
  storage_key: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Long enough to cover the redirect plus a slow transfer of a 50 MB attachment; short enough that
// a leaked URL is not a lasting grant. Supabase validates the token when the request starts, so an
// in-flight download is not cut off at expiry.
const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class FilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private get storageBase(): string {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT') ?? '';
    return endpoint.replace(/\/storage\/v1\/s3\/?$/, '');
  }

  private get bucket(): string {
    return this.config.get<string>('STORAGE_BUCKET') ?? 'messenger-files';
  }

  private supabaseHeaders(): Record<string, string> {
    const serviceKey = this.config.get<string>('SUPABASE_SERVICE_KEY');
    return serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {};
  }

  private async fetchRow(fileId: string, requesterId: string): Promise<FileRow> {
    const r = await this.db.query<FileRow>(
      `SELECT f.id, f.file_name, f.mime_type, f.size_bytes, f.has_thumbnail, f.duration_secs,
              f.created_at, f.uploader_id, f.storage_key, m.conversation_id
       FROM files f
       LEFT JOIN messages m ON m.id = f.message_id
       WHERE f.id = $1`,
      [fileId],
    );
    if (!r.rows[0]) throw new NotFoundException('File not found');
    const row = r.rows[0];

    if (row.conversation_id) {
      const mem = await this.db.query(
        'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        [row.conversation_id, requesterId],
      );
      if (!mem.rows[0]) throw new ForbiddenException('Access denied');
    } else if (row.uploader_id !== requesterId) {
      throw new ForbiddenException('Access denied');
    }
    return row;
  }

  async uploadFile(uploaderId: string, file: Express.Multer.File): Promise<{
    id: string; fileName: string; mimeType: string; sizeBytes: number;
    hasThumbnail: boolean; durationSecs: null; createdAt: string;
  }> {
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File too large (max 50 MB)');

    const ext = path.extname(file.originalname).toLowerCase();
    const storageKey = `${randomUUID()}${ext}`;
    const base = this.storageBase;
    const bucket = this.bucket;
    const headers = this.supabaseHeaders();

    let buffer = file.buffer;
    let mimeType = file.mimetype;
    let hasThumbnail = false;

    // Generate thumbnail for images
    if (file.mimetype.startsWith('image/')) {
      try {
        const sharp = (await import('sharp')).default;
        const thumb = await sharp(buffer).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
        const thumbKey = `thumbnails/${storageKey}`;
        const thumbUrl = `${base}/storage/v1/object/${bucket}/${thumbKey}`;
        const uploadThumb = await fetch(thumbUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
          body: thumb,
        });
        if (uploadThumb.ok) hasThumbnail = true;
      } catch {
        // thumbnail generation failed — proceed without
      }
    }

    // Upload original
    const uploadUrl = `${base}/storage/v1/object/${bucket}/${storageKey}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': mimeType, 'x-upsert': 'true' },
      body: buffer,
    });
    if (!uploadRes.ok) {
      const msg = await uploadRes.text().catch(() => 'storage error');
      throw new BadRequestException(`Storage upload failed: ${msg}`);
    }

    const r = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO files (uploader_id, storage_key, file_name, mime_type, size_bytes, has_thumbnail)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [uploaderId, storageKey, file.originalname, mimeType, file.size, hasThumbnail],
    );
    const row = r.rows[0];
    return {
      id: row.id, fileName: file.originalname, mimeType, sizeBytes: file.size,
      hasThumbnail, durationSecs: null, createdAt: row.created_at,
    };
  }

  async getFileMeta(fileId: string, requesterId: string) {
    const row = await this.fetchRow(fileId, requesterId);
    return {
      id: row.id, fileName: row.file_name, mimeType: row.mime_type,
      sizeBytes: row.size_bytes, hasThumbnail: row.has_thumbnail,
      durationSecs: row.duration_secs, createdAt: row.created_at,
    };
  }

  async getFileDownloadUrl(fileId: string, requesterId: string): Promise<{ url: string }> {
    const row = await this.fetchRow(fileId, requesterId);
    return { url: await this.signObject(row.storage_key) };
  }

  async getThumbnailUrl(fileId: string, requesterId: string): Promise<{ url: string }> {
    const row = await this.fetchRow(fileId, requesterId);
    if (!row.has_thumbnail) throw new NotFoundException('No thumbnail');
    return { url: await this.signObject(`thumbnails/${row.storage_key}`) };
  }

  /**
   * Mint a short-lived signed URL for a stored object.
   *
   * These used to be `/object/public/...` links against a public bucket, which made the
   * membership check in fetchRow a one-time gate rather than an access control: the URL kept
   * working, unauthenticated, forever — including for someone later removed from the
   * conversation, or for anyone the link leaked to. The client follows this redirect
   * immediately, so the lifetime only has to cover the redirect and the transfer.
   */
  private async signObject(objectPath: string): Promise<string> {
    const res = await fetch(
      `${this.storageBase}/storage/v1/object/sign/${this.bucket}/${objectPath}`,
      {
        method: 'POST',
        headers: { ...this.supabaseHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
      },
    );

    if (!res.ok) {
      if (res.status === 404) throw new NotFoundException('File not found in storage');
      const detail = await res.text().catch(() => '');
      throw new BadRequestException(`Could not sign file URL: ${detail.slice(0, 200)}`);
    }

    // Supabase returns the path portion only, e.g. "/object/sign/<bucket>/<key>?token=…"
    const { signedURL } = (await res.json()) as { signedURL: string };
    return `${this.storageBase}/storage/v1${signedURL}`;
  }
}
