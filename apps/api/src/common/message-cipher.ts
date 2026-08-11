import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Encryption at rest for message bodies.
 *
 * **This is not end-to-end encryption, and must not be described as one.** The key lives on the
 * server, so the running API can read every message, and so can anyone who holds both the database
 * and the key. What it removes is the far more likely exposure: a database dump, a backup, a
 * misplaced connection string, or the hosting provider's own staff reading the `messages` table.
 * Until now that table held base64 — an encoding, not a cipher — under a column named `ciphertext`,
 * which was the most misleading thing in the schema.
 *
 * End-to-end is a different project. It needs per-device keys, a key exchange, verification, and
 * an answer for everything the server currently does with message text: search, notification
 * previews, and the last-message line in the conversation list all read bodies today, and none of
 * them can once only the participants hold the key. The Signal Protocol tables in the schema are
 * where that work would go.
 *
 * ## Format
 *
 * ```
 * [0x01][12-byte IV][16-byte auth tag][ciphertext…]
 * ```
 *
 * AES-256-GCM, so a tampered row fails to decrypt rather than decrypting to something else. A
 * fresh random IV per message: GCM repeats catastrophically if an IV is reused under one key, and
 * random-per-message is the standard way to avoid a counter that has to survive restarts.
 *
 * The leading version byte is what makes this deployable on a live database. Rows written before
 * this existed hold base64 text, whose first byte is always a printable ASCII character and
 * therefore never 0x01 — so old and new rows are told apart with certainty rather than a guess,
 * and both read correctly while a migration runs or if one never does.
 */

const VERSION_1 = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const logger = new Logger('MessageCipher');

let cachedKey: Buffer | null | undefined;

/**
 * The key, or null when none is configured.
 *
 * Read once and remembered, including the absence, so a missing key does not log on every message.
 */
function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env.MESSAGE_ENCRYPTION_KEY?.trim();
  if (!raw) {
    logger.warn(
      'MESSAGE_ENCRYPTION_KEY is not set — message bodies are stored unencrypted. '
      + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    cachedKey = null;
    return null;
  }

  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== KEY_BYTES) {
    // Thrown rather than warned. A key of the wrong length is a typo in a deployment variable, and
    // carrying on would write messages that the intended key cannot read.
    throw new Error(
      `MESSAGE_ENCRYPTION_KEY must be ${KEY_BYTES} bytes as ${KEY_BYTES * 2} hex characters; got ${buf.length} bytes`,
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/** Test seam. Nothing in the application calls this. */
export function resetMessageCipherForTests(): void {
  cachedKey = undefined;
}

/** Whether bodies written from now on will be encrypted. */
export function isEncryptionEnabled(): boolean {
  return key() !== null;
}

/**
 * The bytes to store for a message body.
 *
 * An empty body stays empty: a deleted message is blanked to zero bytes, and encrypting nothing
 * into 29 bytes of envelope would make deleted rows look like they still held something.
 */
export function encryptMessage(text: string): Buffer {
  if (text.length === 0) return Buffer.alloc(0);

  const k = key();
  if (!k) return Buffer.from(text, 'utf8');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION_1]), iv, cipher.getAuthTag(), body]);
}

/**
 * The text a stored body holds, whichever era it was written in.
 *
 * Never throws. A body that cannot be read is a message someone is trying to open — returning
 * empty puts one unreadable bubble on screen, where throwing would fail the whole page it appears
 * on and take the rest of the conversation with it.
 */
export function decryptMessage(bytes: Uint8Array | null | undefined): string {
  if (!bytes || bytes.length === 0) return '';

  const buf = Buffer.from(bytes);
  // Written before encryption existed, or written while no key was configured.
  if (buf[0] !== VERSION_1) return buf.toString('utf8');
  // Long enough to be an envelope? A body that merely starts with 0x01 and is shorter than the
  // header cannot be one.
  if (buf.length < 1 + IV_BYTES + TAG_BYTES) return buf.toString('utf8');

  const k = key();
  if (!k) {
    logger.warn('An encrypted message was read but MESSAGE_ENCRYPTION_KEY is not set');
    return '';
  }

  try {
    const iv = buf.subarray(1, 1 + IV_BYTES);
    const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const body = buf.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // A wrong key, or a row altered underneath us. Both are worth a line in the log and neither is
    // worth failing the request over.
    logger.warn('A message body could not be decrypted — wrong key, or the row was altered');
    return '';
  }
}

/** For raw SQL, which returns the column base64-encoded rather than as bytes. */
export function decryptBase64Message(value: string | null | undefined): string {
  if (!value) return '';
  return decryptMessage(Buffer.from(value, 'base64'));
}
