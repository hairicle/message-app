import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { randomUUID } from 'crypto';
import * as path from 'path';

interface FileRow {
  id: string; file_name: string; mime_type: string; size_bytes: number;
  has_thumbnail: boolean; duration_secs: number | null; created_at: string;
  uploader_id: string | null; conversation_id: string | null;
  storage_key: string;
}

/**
 * Longest edge of the preview the thread renders. Not a thumbnail in the usual sense — nothing
 * else is shown for an image message, so this is the picture people actually look at.
 */
const THUMBNAIL_EDGE = 1280;
const THUMBNAIL_QUALITY = 82;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Long enough to cover the redirect plus a slow transfer of a 50 MB attachment; short enough that
// a leaked URL is not a lasting grant. Supabase validates the token when the request starts, so an
// in-flight download is not cut off at expiry.
const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
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
    const file = await this.prisma.files.findUnique({
      where: { id: fileId },
      select: {
        id: true, file_name: true, mime_type: true, size_bytes: true, has_thumbnail: true,
        duration_secs: true, created_at: true, uploader_id: true, storage_key: true,
        // LEFT JOIN messages: a file not yet attached to a message has no conversation.
        messages: { select: { conversation_id: true } },
      },
    });
    if (!file) throw new NotFoundException('File not found');

    const { messages, ...rest } = file;
    const row: FileRow = {
      ...rest,
      // size_bytes is a bigint column; the API has always sent it as a number.
      size_bytes: Number(rest.size_bytes),
      created_at: rest.created_at.toISOString(),
      conversation_id: messages?.conversation_id ?? null,
    };

    if (row.conversation_id) {
      const member = await this.prisma.conversation_members.findUnique({
        where: { conversation_id_user_id: { conversation_id: row.conversation_id, user_id: requesterId } },
        select: { id: true },
      });
      if (!member) throw new ForbiddenException('Access denied');
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

    // A preview for images.
    //
    // Called a thumbnail, but it is what the thread actually shows: a message bubble renders this
    // rather than the original, so 400px at quality 75 was every photo in every conversation
    // looking soft — a bubble is up to 280 CSS pixels, which is 560 real ones on a retina screen
    // and 840 on a phone, so a 400px source was being enlarged before anyone saw it.
    //
    // 1280 at quality 82 is sharp at any of those sizes and still a fraction of a twelve-megapixel
    // original, which is the point of not sending the original to a list of bubbles.
    if (file.mimetype.startsWith('image/')) {
      try {
        const sharp = (await import('sharp')).default;
        const thumb = await sharp(buffer)
          .rotate()
          .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
          .toBuffer();
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

    const row = await this.prisma.files.create({
      data: {
        uploader_id: uploaderId,
        storage_key: storageKey,
        file_name: file.originalname,
        mime_type: mimeType,
        size_bytes: file.size,
        has_thumbnail: hasThumbnail,
      },
      select: { id: true, created_at: true },
    });
    return {
      id: row.id, fileName: file.originalname, mimeType, sizeBytes: file.size,
      hasThumbnail, durationSecs: null, createdAt: row.created_at.toISOString(),
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
