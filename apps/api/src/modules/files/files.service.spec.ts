import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { createPrismaMock, MEMBER, type PrismaMock } from '../../testing/prisma-mock';

const UPLOADER = 'user-1';
const STRANGER = 'user-2';
const CONV = 'conv-1';
const FILE = 'file-1';

const config = {
  get: (key: string) =>
    ({
      STORAGE_ENDPOINT: 'https://project.supabase.co/storage/v1/s3',
      STORAGE_BUCKET: 'messenger-files',
      SUPABASE_SERVICE_KEY: 'service-key',
    })[key],
} as never;

/** The stubbed global fetch, typed so its recorded calls are readable. */
const fetchMock = () =>
  globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } };

const fileRow = (over: Record<string, unknown> = {}) => ({
  id: FILE,
  file_name: 'photo.png',
  mime_type: 'image/png',
  size_bytes: 1024n,
  has_thumbnail: true,
  duration_secs: null,
  created_at: new Date('2026-08-01T00:00:00Z'),
  uploader_id: UPLOADER,
  storage_key: 'abc.png',
  messages: { conversation_id: CONV },
  ...over,
});

describe('FilesService', () => {
  let prisma: PrismaMock;
  let service: FilesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new FilesService(prisma, config);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ signedURL: '/object/sign/messenger-files/abc.png?token=SIGNED' }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('access control', () => {
    it('allows a member of the conversation the file was posted in', async () => {
      prisma.files.findUnique.mockResolvedValue(fileRow());
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      await expect(service.getFileMeta(FILE, STRANGER)).resolves.toMatchObject({ id: FILE });
    });

    it('denies someone who is not in that conversation', async () => {
      prisma.files.findUnique.mockResolvedValue(fileRow());
      prisma.conversation_members.findUnique.mockResolvedValue(null);
      await expect(service.getFileMeta(FILE, STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falls back to uploader ownership for a file not yet attached to a message', async () => {
      // messages is null until sendMessage attaches the upload.
      prisma.files.findUnique.mockResolvedValue(fileRow({ messages: null }));
      await expect(service.getFileMeta(FILE, UPLOADER)).resolves.toMatchObject({ id: FILE });
      // No conversation to check, so membership must not be consulted at all.
      expect(prisma.conversation_members.findUnique).not.toHaveBeenCalled();
    });

    it('denies a stranger an unattached upload', async () => {
      prisma.files.findUnique.mockResolvedValue(fileRow({ messages: null }));
      await expect(service.getFileMeta(FILE, STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reports an unknown file as not found', async () => {
      prisma.files.findUnique.mockResolvedValue(null);
      await expect(service.getFileMeta(FILE, UPLOADER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('signed URLs', () => {
    beforeEach(() => {
      prisma.files.findUnique.mockResolvedValue(fileRow());
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
    });

    it('signs the object instead of handing out a public URL', async () => {
      const { url } = await service.getFileDownloadUrl(FILE, UPLOADER);
      expect(url).toContain('/object/sign/');
      expect(url).not.toContain('/object/public/');
      expect(url).toContain('token=SIGNED');
    });

    it('requests a short lifetime', async () => {
      await service.getFileDownloadUrl(FILE, UPLOADER);
      const body = JSON.parse(fetchMock().mock.calls[0][1].body);
      expect(body.expiresIn).toBeLessThanOrEqual(300);
      expect(body.expiresIn).toBeGreaterThan(0);
    });

    it('signs the thumbnail under its own prefix', async () => {
      await service.getThumbnailUrl(FILE, UPLOADER);
      const calledUrl = fetchMock().mock.calls[0][0] as string;
      expect(calledUrl).toContain('/thumbnails/abc.png');
    });

    it('reports a missing thumbnail rather than signing one that does not exist', async () => {
      prisma.files.findUnique.mockResolvedValue(fileRow({ has_thumbnail: false }));
      await expect(service.getThumbnailUrl(FILE, UPLOADER)).rejects.toBeInstanceOf(NotFoundException);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('does not sign anything for a caller who fails the access check', async () => {
      prisma.conversation_members.findUnique.mockResolvedValue(null);
      await expect(service.getFileDownloadUrl(FILE, STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('surfaces a storage 404 as not found', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'missing' }));
      await expect(service.getFileDownloadUrl(FILE, UPLOADER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('metadata', () => {
    it('exposes the bigint size as a number so the response serialises', async () => {
      prisma.files.findUnique.mockResolvedValue(fileRow({ size_bytes: 9_000_000n }));
      prisma.conversation_members.findUnique.mockResolvedValue(MEMBER);
      const meta = await service.getFileMeta(FILE, UPLOADER);
      expect(meta.sizeBytes).toBe(9_000_000);
      expect(typeof meta.sizeBytes).toBe('number');
      expect(() => JSON.stringify(meta)).not.toThrow();
    });
  });
});
