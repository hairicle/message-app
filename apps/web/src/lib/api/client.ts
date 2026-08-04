export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const TOKEN_STORAGE_KEY = 'messenger.token';
const DEVICE_ID_STORAGE_KEY = 'messenger.deviceId';

let authToken: string | null = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getAuthToken() {
  return authToken;
}

export function setDeviceId(deviceId: string | null) {
  if (deviceId) {
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  } else {
    localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
  }
}

export function getDeviceId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DEVICE_ID_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Request failed with status ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
