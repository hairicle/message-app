import { API_URL, apiFetch } from './client';
import type { UserProfile } from '@messenger/shared';

export function getMyProfile() {
  return apiFetch<{ profile: UserProfile }>('/api/users/me');
}

export function updateProfile(fields: { displayName?: string; department?: string | null }) {
  return apiFetch<{ profile: UserProfile }>('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function uploadAvatar(file: File) {
  const fd = new FormData();
  fd.append('avatar', file);
  return apiFetch<{ profile: UserProfile }>('/api/users/me/avatar', {
    method: 'POST',
    body: fd,
  });
}

export function getAvatarUrl(userId: string) {
  return `${API_URL}/api/users/${userId}/avatar`;
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<void>('/api/users/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function getNotificationPrefs() {
  return apiFetch<{ prefs: { soundEnabled: boolean; desktopEnabled: boolean; emailEnabled: boolean } }>(
    '/api/users/me/notifications',
  );
}

export function updateNotificationPrefs(prefs: {
  soundEnabled?: boolean;
  desktopEnabled?: boolean;
  emailEnabled?: boolean;
}) {
  return apiFetch<{ prefs: { soundEnabled: boolean; desktopEnabled: boolean; emailEnabled: boolean } }>(
    '/api/users/me/notifications',
    { method: 'PATCH', body: JSON.stringify(prefs) },
  );
}

export function setupTotp() {
  return apiFetch<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>('/api/auth/totp/setup', {
    method: 'POST',
  });
}

export function enableTotp(code: string) {
  return apiFetch<{ totpEnabled: boolean }>('/api/auth/totp/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function disableTotp(code: string) {
  return apiFetch<{ totpEnabled: boolean }>('/api/auth/totp', {
    method: 'DELETE',
    body: JSON.stringify({ code }),
  });
}
