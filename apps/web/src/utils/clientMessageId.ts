/**
 * An id the sender attaches to a message so a retry is recognised rather than duplicated.
 *
 * Sending is at-least-once: the client waits for an acknowledgement and cannot tell "the server
 * never received it" from "the server saved it and the reply was lost", so it assumes the first and
 * sends again. The server matches this id against what that sender has already written and returns
 * the existing message instead of storing a second one.
 *
 * The id must be generated **once per message**, when it is written — never per attempt. A fresh id
 * on each retry would be a fresh message on each retry, which is precisely the bug.
 */
export function newClientMessageId(): string {
  // `crypto.randomUUID` needs a secure context, which is every real deployment and localhost, but
  // not a page served over plain HTTP from a LAN address — which is exactly how someone tests on a
  // phone. Falling back keeps that case working rather than throwing at the moment of sending.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return uuidV4FromRandomBytes();
}

/**
 * A version-4 UUID built from `getRandomValues`, or from `Math.random` if even that is missing.
 *
 * The shape has to be a valid UUID because the server validates it as one, so the version and
 * variant bits are set explicitly rather than left to chance.
 */
function uuidV4FromRandomBytes(): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
