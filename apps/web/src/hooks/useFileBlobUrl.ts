'use client';

import { useEffect, useState } from 'react';
import { fetchFileBlob, fetchThumbnailBlob } from '../lib/api/files';

export type FileBlobVariant = 'original' | 'thumbnail';

const blobUrlCache = new Map<string, string | 'error'>();

export function useFileBlobUrl(fileId: string | undefined, variant: FileBlobVariant = 'original'): string | null {
  const cacheKey = fileId ? `${variant}:${fileId}` : undefined;

  const initialState = cacheKey ? (blobUrlCache.get(cacheKey) ?? null) : null;
  const [url, setUrl] = useState<string | null>(
    initialState === 'error' ? 'error' : initialState,
  );

  useEffect(() => {
    if (!fileId || !cacheKey) return;

    const cached = blobUrlCache.get(cacheKey);
    if (cached) {
      setUrl(cached === 'error' ? 'error' : cached);
      return;
    }

    let cancelled = false;
    const fetcher = variant === 'thumbnail' ? fetchThumbnailBlob : fetchFileBlob;

    // Timeout: if fetch takes longer than 15s, mark as error
    const timer = setTimeout(() => {
      if (!cancelled) {
        blobUrlCache.set(cacheKey, 'error');
        setUrl('error');
      }
    }, 15_000);

    fetcher(fileId)
      .then((blob) => {
        clearTimeout(timer);
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlCache.set(cacheKey, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        clearTimeout(timer);
        if (!cancelled) {
          blobUrlCache.set(cacheKey, 'error');
          setUrl('error');
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fileId, variant, cacheKey]);

  return url;
}
