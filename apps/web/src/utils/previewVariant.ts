import type { FileMeta } from '@messenger/shared';

/**
 * Below this, the original is sent to the browser instead of the preview.
 *
 * A preview exists to avoid pushing a twelve-megapixel photo into a list of bubbles. When the
 * original is already this small there is nothing to save, and the original is always the sharper
 * of the two — which also rescues images uploaded before the preview size was raised, whose
 * previews are 400px and cannot be regenerated without reprocessing every file ever sent.
 */
const SMALL_ENOUGH_BYTES = 600 * 1024;

/** Which stored copy of an image to display. */
export function previewVariant(file: Pick<FileMeta, 'hasThumbnail' | 'sizeBytes'> | undefined | null): 'thumbnail' | 'original' {
  if (!file?.hasThumbnail) return 'original';
  if (typeof file.sizeBytes === 'number' && file.sizeBytes <= SMALL_ENOUGH_BYTES) return 'original';
  return 'thumbnail';
}
