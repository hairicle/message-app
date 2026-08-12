/**
 * A sentence a person can read, from whatever was thrown.
 *
 * The socket handlers returned `err.message` directly, which is fine for the exceptions this code
 * raises deliberately and wrong for the ones a library raises. A ZodError's `message` is its whole
 * issue array serialised as JSON, so refusing an oversized message over the socket answered the
 * client with sixteen lines of `{"code":"too_big","maximum":65536,…}` where the HTTP route answered
 * "That message is too long".
 *
 * The HTTP filter already does this shaping. This is the same idea for the transport that has no
 * filter to run through.
 */

interface ZodLikeError {
  name: string;
  issues: { path: (string | number)[]; message: string }[];
}

function isZodError(error: unknown): error is ZodLikeError {
  return (
    typeof error === 'object'
    && error !== null
    && (error as ZodLikeError).name === 'ZodError'
    && Array.isArray((error as ZodLikeError).issues)
  );
}

export function readableError(error: unknown, fallback: string): string {
  if (isZodError(error)) {
    const [first] = error.issues;
    if (!first) return fallback;
    // The field is named only when there is one, because "conversationId: Required" reads as an
    // instruction while "That message is too long" reads as an answer.
    const field = first.path.join('.');
    return field ? `${field}: ${first.message}` : first.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
