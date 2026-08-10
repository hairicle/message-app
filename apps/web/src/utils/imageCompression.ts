/**
 * Longest edge a photo is reduced to when sent as a photo rather than as a file.
 *
 * Deliberately generous: 2048px still fills any screen anyone here will open it on, and the point
 * is to take the edge off a 12-megapixel phone photo, not to make it small. Anyone who wants the
 * original sends it as a file instead.
 */
export const MAX_PHOTO_EDGE = 2048;

/** Re-encoding quality. High enough that the difference is hard to see side by side. */
export const PHOTO_QUALITY = 0.85;

/**
 * Animation does not survive being drawn to a canvas — only the first frame would. A GIF is
 * therefore always sent as-is, whichever mode is chosen.
 */
export const UNCOMPRESSABLE = ['image/gif'];

/**
 * Dimensions that fit inside `max` without changing the shape, and without ever enlarging.
 *
 * Scaling a small image up to the cap would make the file bigger while adding nothing, which is
 * the opposite of the point.
 */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  // Rounded, and never to zero: a canvas of width 0 throws.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Whether this file is worth trying to compress at all. */
export function isCompressible(file: File): boolean {
  return file.type.startsWith('image/') && !UNCOMPRESSABLE.includes(file.type);
}

/**
 * A smaller version of an image, or the original when that would not help.
 *
 * Re-encoding can easily produce a *larger* file — a screenshot saved as PNG becomes bigger as a
 * JPEG of the same dimensions, and a photo already sized for the web gains nothing. Returning the
 * original in those cases means choosing "photo" is never worse than choosing "file", only
 * smaller or the same.
 */
export async function compressImage(file: File): Promise<File> {
  if (!isCompressible(file)) return file;

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not read the image'));
      img.src = url;
    });

    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, width, height);

    // JPEG unless the source has an alpha channel, which flattening would fill with black.
    const type = file.type === 'image/png' || file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const extension = type === 'image/webp' ? 'webp' : 'jpg';
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + extension;
    return new File([blob], name, { type, lastModified: file.lastModified });
  } catch {
    // A file the browser cannot decode is still a file worth sending.
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
