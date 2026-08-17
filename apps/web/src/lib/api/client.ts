export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const TOKEN_STORAGE_KEY = 'messenger.token';
const DEVICE_ID_STORAGE_KEY = 'messenger.deviceId';
const REFRESH_STORAGE_KEY = 'messenger.refreshToken';

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

/**
 * The refresh token, which outlives the access token and is what keeps someone signed in.
 *
 * In localStorage alongside the access token. That is not where a refresh token ideally lives — an
 * httpOnly cookie would be out of reach of scripts — but the API authenticates with a bearer token
 * and has no cookie session, so moving it there is a change to both ends rather than a line here.
 * Worth doing; not worth pretending is done.
 */
export function setRefreshToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(REFRESH_STORAGE_KEY, token);
  else localStorage.removeItem(REFRESH_STORAGE_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_STORAGE_KEY);
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

// A 401 from these is a failed sign-in attempt (bad password / bad TOTP code) — it belongs in the
// form, not treated as an expired session. Every other 401 means the JWT lapsed or was revoked.
const SIGN_IN_PATHS = ['/api/auth/login'];

let onSessionExpired: (() => void) | null = null;

/**
 * The in-flight renewal, if there is one.
 *
 * A page load fires several requests at once, so an expired access token produces several 401s at
 * the same moment. Without this they would each refresh, and because refreshing *rotates* the
 * token, all but one would be exchanging a value that had just been spent — every one of them
 * failing, and taking the session with them. Sharing the promise means one renewal, awaited by all.
 */
let renewal: Promise<boolean> | null = null;

function clearSession() {
  setAuthToken(null);
  setDeviceId(null);
  setRefreshToken(null);
}

/** True when the session was renewed and the retry is worth making. */
async function renewSession(): Promise<boolean> {
  if (renewal) return renewal;

  renewal = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      // Deliberately a bare fetch rather than apiFetch: this must not carry the dead access token,
      // and a 401 here means the session is over rather than something to retry.
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      setAuthToken(body.token);
      setRefreshToken(body.refreshToken);
      if (body.deviceId) setDeviceId(body.deviceId);
      return true;
    } catch {
      // Offline. Not a reason to throw the session away — the token may still be perfectly good
      // once the network returns.
      return false;
    } finally {
      renewal = null;
    }
  })();

  return renewal;
}

/** Registered by AuthContext so an expired token clears auth state instead of throwing blindly. */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
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

    if (res.status === 401 && !SIGN_IN_PATHS.some((p) => path.startsWith(p))) {
      // An access token is short-lived by design, so the ordinary meaning of a 401 is "that one
      // has aged out", not "this person is no longer welcome". Trade the refresh token for a new
      // one and repeat the request — the caller never learns it happened.
      //
      // `isRetry` stops a refresh that itself fails from looping: one attempt, then give up.
      if (!isRetry && getRefreshToken()) {
        const renewed = await renewSession();
        if (renewed) return apiFetch<T>(path, options, true);
      }

      // Genuinely over: no refresh token, or the refresh was refused because it was spent, expired
      // or the account was disabled. Drop the dead credentials and let the app route back to login
      // rather than letting every in-flight request reject and surface as a crash overlay.
      clearSession();
      onSessionExpired?.();
    }

    throw new ApiError(res.status, body?.error ?? `Request failed with status ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
