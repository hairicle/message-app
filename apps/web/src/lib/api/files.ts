import { API_URL, ApiError, apiFetch, getAuthToken } from './client';
import type { FileMeta } from '@messenger/shared';

/**
 * Upload a file, optionally reporting progress.
 *
 * XMLHttpRequest rather than fetch: fetch cannot report how much of a request body has been
 * sent, so there is no way to show a percentage for a large attachment with it. The signature is
 * unchanged for callers that do not pass `onProgress`.
 */
export function uploadFile(
  file: File | Blob,
  fileName?: string,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ file: FileMeta }> {
  const formData = new FormData();
  formData.append('file', file, fileName);

  if (!options.onProgress && !options.signal) {
    return apiFetch<{ file: FileMeta }>('/api/files', { method: 'POST', body: formData });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/files`);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      // Not every transfer reports a total; leaving the caller on its last known value is better
      // than reporting a wrong one.
      if (e.lengthComputable && e.total > 0) options.onProgress?.(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Upload succeeded but the response could not be read'));
        }
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (body?.error) message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      } catch { /* keep the status-based message */ }
      reject(new ApiError(xhr.status, message));
    };

    xhr.onerror = () => reject(new Error('Upload failed — the network dropped'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));

    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}

export async function fetchFileBlob(fileId: string): Promise<Blob> {
  const token = getAuthToken();
  const res = await fetch(`${API_URL}/api/files/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch file ${fileId}`);
  }
  return res.blob();
}

export async function fetchThumbnailBlob(fileId: string): Promise<Blob> {
  const token = getAuthToken();
  const res = await fetch(`${API_URL}/api/files/${fileId}/thumbnail`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch thumbnail ${fileId}`);
  }
  return res.blob();
}
