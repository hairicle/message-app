'use client';

import { useEffect, useState } from 'react';
import { fetchFileBlob, fetchThumbnailBlob } from '../lib/api/files';

export type FileBlobVariant = 'original' | 'thumbnail';

const blobUrlCache = new Map<string, string>();

export function useFileBlobUrl(fileId: string | undefined, variant: FileBlobVariant = 'original'): string | null {
  const cacheKey = fileId ? `${variant}:${fileId}` : undefined;
  const [url, setUrl] = useState<string | null>(cacheKey ? blobUrlCache.get(cacheKey) ?? null : null);

  useEffect(() => {
    if (!fileId || !cacheKey) return;

    const cached = blobUrlCache.get(cacheKey);
    if (cached) {
      setUrl(cached);
      return;
    }

    let cancelled = false;
    const fetcher = variant === 'thumbnail' ? fetchThumbnailBlob : fetchFileBlob;
    fetcher(fileId)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlCache.set(cacheKey, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, variant, cacheKey]);

  return url;
}
