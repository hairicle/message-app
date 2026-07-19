import { API_URL, apiFetch, getAuthToken } from './client';
import type { FileMeta } from '@messenger/shared';

export function uploadFile(file: File | Blob, fileName?: string) {
  const formData = new FormData();
  formData.append('file', file, fileName);

  return apiFetch<{ file: FileMeta }>('/api/files', {
    method: 'POST',
    body: formData,
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
