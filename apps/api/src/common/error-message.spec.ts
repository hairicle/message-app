import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readableError } from './error-message';

const zodErrorFrom = (schema: z.ZodTypeAny, value: unknown) => {
  try { schema.parse(value); } catch (err) { return err; }
  throw new Error('the schema unexpectedly accepted the value');
};

describe('readableError', () => {
  // The reason this exists: a ZodError's own `message` is its whole issue array as JSON, so the
  // socket answered an oversized message with sixteen lines of {"code":"too_big",…} where the HTTP
  // route answered a sentence.
  it('reads a schema failure as its message, not as JSON', () => {
    const schema = z.object({ ciphertext: z.string().max(5, 'That message is too long') });
    const out = readableError(zodErrorFrom(schema, { ciphertext: 'far too long' }), 'fallback');
    expect(out).toContain('That message is too long');
    expect(out).not.toContain('{');
    expect(out).not.toContain('too_big');
  });

  it('names the field when the message alone would not say which', () => {
    const schema = z.object({ conversationId: z.string().uuid() });
    expect(readableError(zodErrorFrom(schema, { conversationId: 'nope' }), 'fallback'))
      .toContain('conversationId');
  });

  it('passes an ordinary error through', () => {
    expect(readableError(new Error('Not a member of this conversation'), 'fallback'))
      .toBe('Not a member of this conversation');
  });

  for (const value of [undefined, null, 'a bare string', 42, new Error('')]) {
    it(`falls back for ${JSON.stringify(value)}`, () => {
      expect(readableError(value, 'Failed to send message')).toBe('Failed to send message');
    });
  }

  // An object that merely looks similar must not be mistaken for a schema failure.
  it('does not treat any error carrying issues as a schema failure', () => {
    expect(readableError(Object.assign(new Error('nope'), { issues: [] }), 'fallback')).toBe('nope');
  });
});
