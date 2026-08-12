/**
 * How much text a message may carry.
 *
 * The server's backstop is 64 KB of the encoded body (MAX_MESSAGE_BYTES in
 * apps/api/src/modules/messages/message-limits.ts). This is the smaller number a person actually
 * meets, expressed in the unit they are working in — characters typed, not bytes transmitted.
 *
 * Enforced here so a long paste is refused while it can still be edited. Without a client limit the
 * two transports failed differently and neither said anything useful: over HTTP the request came
 * back a server error, and over the socket the message was dropped with no answer at all, leaving it
 * on screen looking as though it had been sent.
 */
export const MAX_MESSAGE_CHARS = 8000;

/** When to start showing the count — near enough to matter, far enough not to nag. */
const WARN_AT = 0.9;

export function isOverMessageLimit(text: string): boolean {
  return charCount(text) > MAX_MESSAGE_CHARS;
}

/**
 * Characters as a person counts them.
 *
 * `String.length` counts UTF-16 units, so an emoji reads as two and a flag as four — someone
 * pasting emoji would watch the counter fall twice as fast as the text they can see. Splitting by
 * code point is closer to what is on screen.
 */
export function charCount(text: string): number {
  return [...text].length;
}

/**
 * What to show beneath the composer, or null while there is nothing worth saying.
 *
 * Returns the whole label rather than a boolean and a number, so the wording cannot drift between
 * the two states it has.
 */
export function messageLengthHint(text: string): { label: string; over: boolean } | null {
  const count = charCount(text);
  if (count < MAX_MESSAGE_CHARS * WARN_AT) return null;
  const over = count > MAX_MESSAGE_CHARS;
  return {
    label: over
      ? `${(count - MAX_MESSAGE_CHARS).toLocaleString()} characters over the limit`
      : `${(MAX_MESSAGE_CHARS - count).toLocaleString()} characters left`,
    over,
  };
}
