/**
 * The limits and the content-type rule, in one place.
 *
 * The size used to be written three times — twice in this module and once per avatar route — and
 * the multer interceptors did not know it at all, which is how a 150 MB body came to be read into
 * memory in full before a 50 MB limit refused it.
 */

/** Largest attachment. Mirrored by MAX_ATTACHMENT_BYTES in apps/web/src/utils/uploadLimits.ts. */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Largest profile or group picture. Mirrored by MAX_AVATAR_BYTES in the same web module. */
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

/** What a neutralised file is stored as: bytes with no meaning a browser will act on. */
export const INERT_MIME_TYPE = 'application/octet-stream';

/**
 * Declared types a browser will execute or render as a document rather than show as data.
 *
 * SVG belongs here despite being an image: it is an XML document that may carry script, and it is
 * the reason "just check it is an image" is not a content-type policy.
 */
const RENDERABLE_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-javascript',
  'text/vbscript',
  'application/xslt+xml',
]);

/**
 * The type a file should be **stored** as, given what the client declared.
 *
 * Nothing is rejected. This is a messenger: people send spreadsheets, archives and installers, and
 * an allowlist would be wrong about a colleague's work file every week. What is removed is the
 * ability of an uploaded file to *run* — a type a browser would execute is stored as opaque bytes
 * instead, so the file still downloads under its own name and can never render itself.
 *
 * The alternative was to rely on the storage provider, which is what happened until now: an SVG
 * carrying a script was inert only because Supabase chose to serve it as an attachment. That is
 * their behaviour rather than a property of this system, and it moves when a bucket setting or a
 * provider does, without anything here failing.
 *
 * Parameters are stripped before comparing, because `text/html; charset=utf-8` is text/html.
 */
export function storageMimeType(declared: string | undefined | null): string {
  if (!declared) return INERT_MIME_TYPE;
  const base = declared.split(';')[0].trim().toLowerCase();
  if (!base) return INERT_MIME_TYPE;
  return RENDERABLE_TYPES.has(base) ? INERT_MIME_TYPE : base;
}

/** Whether a preview should be attempted — asked of the stored type, so a neutralised file is not. */
export function isPreviewableImage(storedMime: string): boolean {
  return storedMime.startsWith('image/');
}
