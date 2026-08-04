import { apiFetch } from './client';
import type { LoginResponse, TotpRequiredResponse, User } from '@messenger/shared';

export function login(email: string, password: string, deviceName: string) {
  return apiFetch<LoginResponse | TotpRequiredResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, deviceName }),
  });
}

export function completeTotpLogin(totpToken: string, code: string, deviceName: string) {
  return apiFetch<LoginResponse>('/api/auth/login/totp', {
    method: 'POST',
    body: JSON.stringify({ totpToken, code, deviceName }),
  });
}

export function getMe() {
  return apiFetch<{ user: User }>('/api/auth/me');
}
