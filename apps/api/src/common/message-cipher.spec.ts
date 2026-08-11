import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  decryptBase64Message,
  decryptMessage,
  encryptMessage,
  isEncryptionEnabled,
  resetMessageCipherForTests,
} from './message-cipher';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const ORIGINAL = process.env.MESSAGE_ENCRYPTION_KEY;

function withKey(hex: string | undefined) {
  if (hex === undefined) delete process.env.MESSAGE_ENCRYPTION_KEY;
  else process.env.MESSAGE_ENCRYPTION_KEY = hex;
  resetMessageCipherForTests();
}

beforeEach(() => {
  // The warning for a missing key is deliberate behaviour, not noise to assert on here.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  withKey(KEY_A);
});

afterAll(() => withKey(ORIGINAL));

describe('with a key configured', () => {
  it('reports itself enabled', () => {
    expect(isEncryptionEnabled()).toBe(true);
  });

  it('round-trips a message', () => {
    expect(decryptMessage(encryptMessage('meet me at four'))).toBe('meet me at four');
  });

  it('round-trips text that is not ASCII', () => {
    const text = 'សួស្តី 👋 — café';
    expect(decryptMessage(encryptMessage(text))).toBe(text);
  });

  it('round-trips the base64 the client actually sends', () => {
    const body = Buffer.from('the real message').toString('base64');
    expect(decryptMessage(encryptMessage(body))).toBe(body);
  });

  // The stored bytes must not contain the plaintext, or the exercise is pointless.
  it('does not leave the plaintext in the stored bytes', () => {
    const stored = encryptMessage('the secret plan');
    expect(stored.toString('utf8')).not.toContain('the secret plan');
    expect(stored.toString('latin1')).not.toContain('the secret plan');
  });

  // GCM repeats catastrophically under a reused IV, so a fresh one per message is the whole
  // safety argument. Identical plaintext must never produce identical bytes.
  it('produces different bytes for the same text each time', () => {
    const a = encryptMessage('same words');
    const b = encryptMessage('same words');
    expect(a.equals(b)).toBe(false);
    expect(decryptMessage(a)).toBe(decryptMessage(b));
  });

  it('marks its output with the version byte', () => {
    expect(encryptMessage('x')[0]).toBe(0x01);
  });

  describe('a body that was tampered with', () => {
    it('is refused rather than decrypted to something else', () => {
      const stored = encryptMessage('transfer 100');
      stored[stored.length - 1] ^= 0xff;
      expect(decryptMessage(stored)).toBe('');
    });

    it('is refused when the tag is altered', () => {
      const stored = encryptMessage('transfer 100');
      stored[14] ^= 0xff;
      expect(decryptMessage(stored)).toBe('');
    });
  });

  it('cannot be read with a different key', () => {
    const stored = encryptMessage('for your eyes only');
    withKey(KEY_B);
    expect(decryptMessage(stored)).toBe('');
  });
});

describe('rows written before encryption existed', () => {
  // The compatibility that makes this deployable on a live database: base64 always begins with a
  // printable ASCII character, so it can never be mistaken for the 0x01 envelope marker.
  it('are still readable', () => {
    const legacy = Buffer.from(Buffer.from('an older message').toString('base64'), 'utf8');
    expect(decryptMessage(legacy)).toBe(Buffer.from('an older message').toString('base64'));
  });

  it('are readable even when they start with unusual text', () => {
    for (const text of ['{"a":1}', '   ', '<<<', 'binary-ish']) {
      const legacy = Buffer.from(text, 'utf8');
      expect(decryptMessage(legacy)).toBe(text);
    }
  });

  it('are not mistaken for an envelope when too short to be one', () => {
    const shortButMarked = Buffer.from([0x01, 0x02, 0x03]);
    expect(decryptMessage(shortButMarked)).toBe(shortButMarked.toString('utf8'));
  });
});

describe('an empty body', () => {
  // A deleted message is blanked to zero bytes. Encrypting nothing into an envelope would make a
  // deleted row look like it still held something.
  it('stays empty rather than becoming an envelope', () => {
    expect(encryptMessage('')).toHaveLength(0);
  });

  for (const value of [null, undefined, new Uint8Array(0)]) {
    it(`reads ${JSON.stringify(value)} as an empty string`, () => {
      expect(decryptMessage(value)).toBe('');
    });
  }
});

describe('without a key configured', () => {
  beforeEach(() => withKey(undefined));

  it('reports itself disabled', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });

  // Storing plaintext is worse, and it is what happened before. Refusing to start would be a
  // defensible choice too, but not one to make silently on an existing deployment.
  it('stores plaintext and still round-trips', () => {
    expect(decryptMessage(encryptMessage('no key here'))).toBe('no key here');
  });

  it('returns empty rather than throwing when it meets an encrypted row', () => {
    withKey(KEY_A);
    const stored = encryptMessage('written when a key existed');
    withKey(undefined);
    expect(decryptMessage(stored)).toBe('');
  });
});

describe('a key of the wrong length', () => {
  // Thrown, not warned: it is a typo in a deployment variable, and carrying on would write
  // messages the intended key cannot read.
  it('is refused', () => {
    withKey('abcd');
    expect(() => encryptMessage('x')).toThrow(/32 bytes/);
  });
});

describe('decryptBase64Message', () => {
  it('reads what raw SQL hands back', () => {
    const stored = encryptMessage('from a lateral join');
    expect(decryptBase64Message(stored.toString('base64'))).toBe('from a lateral join');
  });

  for (const value of [null, undefined, '']) {
    it(`reads ${JSON.stringify(value)} as an empty string`, () => {
      expect(decryptBase64Message(value)).toBe('');
    });
  }
});
