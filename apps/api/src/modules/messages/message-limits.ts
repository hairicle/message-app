/**
 * How large a message body may be.
 *
 * There was no limit at all, and the two transports failed differently and badly. Over HTTP,
 * anything past roughly 90 KB hit Express's own body-parser ceiling and came back as **500** — a
 * caller's oversized message logged as a server fault. Over the socket, half a megabyte was
 * accepted, and a megabyte was **silently dropped**: no acknowledgement, no error, the message
 * simply never existed. Silence is the worst of the three outcomes, because the person watched it
 * sit there looking sent.
 *
 * This is the transmitted string, which the web client base64-encodes — so it is roughly a third
 * larger than the text someone typed. 64 KB is far beyond any message a person writes and still
 * comfortably inside Express's 100 KB body limit, so a message that is refused is refused by this
 * rule, with a sentence saying so, rather than by infrastructure underneath it.
 *
 * The number a person actually meets is smaller and lives in the client — see MAX_MESSAGE_CHARS in
 * apps/web/src/utils/messageLimits.ts. This one is the backstop.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * The longest search query worth running.
 *
 * Matching happens in Node over a bounded scan, so a five-thousand-character needle was accepted
 * and compared against every row read. Nobody searches for a paragraph.
 */
export const MAX_SEARCH_QUERY = 200;

/**
 * bcrypt ignores everything past 72 bytes.
 *
 * Not a cap this application chose — it is the algorithm's. Accepting a longer password and
 * silently using the first 72 bytes tells someone their 100-character passphrase is stronger than
 * it is, and a live check confirmed it: an account set with a 102-character password opened with
 * the first 72 of them.
 *
 * Counted in bytes rather than characters, because that is what bcrypt truncates — one emoji is
 * four of these.
 */
export const MAX_PASSWORD_BYTES = 72;
