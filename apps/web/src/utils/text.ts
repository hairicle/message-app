// No E2E encryption yet (see backend README) — messages are sent as base64-encoded
// UTF-8 plaintext in the `ciphertext` field. This will be replaced by real
// Signal Protocol encryption in a later phase.

export function encodeMessageText(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export function decodeMessageText(ciphertext: string): string {
  try {
    return decodeURIComponent(escape(atob(ciphertext)));
  } catch {
    return '[unreadable message]';
  }
}
