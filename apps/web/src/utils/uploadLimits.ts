/**
 * What the API will accept, checked before anything is sent.
 *
 * The server is what enforces these — see apps/api/src/modules/files/file-rules.ts, which holds the
 * same two numbers. Repeating them here is not the check; it is the difference between being told
 * a file is too large straight away and watching a progress bar crawl to the end of a 200 MB upload
 * before the answer comes back.
 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Sizes in a message people read: 50 MB, 4.2 MB, 900 KB. */
export function formatLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Why this file cannot be sent, or null if it can.
 *
 * Returns the sentence to show rather than a boolean, so the caller does not have to reassemble
 * one and the two limits cannot end up described differently in two places.
 */
export function attachmentTooLargeMessage(file: { name?: string; size: number }, limit = MAX_ATTACHMENT_BYTES): string | null {
  if (file.size <= limit) return null;
  const name = file.name ? `“${file.name}” is` : 'That file is';
  return `${name} ${formatLimit(file.size)}. The largest that can be sent is ${formatLimit(limit)}.`;
}
