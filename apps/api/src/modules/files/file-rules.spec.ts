import { describe, it, expect } from 'vitest';
import { INERT_MIME_TYPE, isPreviewableImage, storageMimeType } from './file-rules';

describe('storageMimeType', () => {
  describe('a type a browser would execute', () => {
    // The whole point: an SVG carrying a script was inert only because Supabase chose to serve it
    // as an attachment. That is the provider's behaviour, not a property of this system.
    for (const type of [
      'text/html',
      'application/xhtml+xml',
      'image/svg+xml',
      'text/xml',
      'application/xml',
      'application/javascript',
      'text/javascript',
      'application/xslt+xml',
      'text/vbscript',
    ]) {
      it(`stores ${type} as opaque bytes`, () => {
        expect(storageMimeType(type)).toBe(INERT_MIME_TYPE);
      });
    }

    it('is not fooled by a charset parameter', () => {
      expect(storageMimeType('text/html; charset=utf-8')).toBe(INERT_MIME_TYPE);
    });

    it('is not fooled by capitals or padding', () => {
      expect(storageMimeType('  IMAGE/SVG+XML ')).toBe(INERT_MIME_TYPE);
    });
  });

  describe('everything else is kept', () => {
    // Nothing is rejected. People send spreadsheets, archives and installers, and an allowlist
    // would be wrong about a colleague's work file every week.
    for (const type of [
      'image/png',
      'image/jpeg',
      'video/mp4',
      'audio/webm',
      'application/pdf',
      'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
    ]) {
      it(`keeps ${type}`, () => {
        expect(storageMimeType(type)).toBe(type);
      });
    }

    it('normalises case and strips parameters', () => {
      expect(storageMimeType('IMAGE/PNG; charset=binary')).toBe('image/png');
    });
  });

  describe('when the client says nothing useful', () => {
    for (const value of [undefined, null, '', '   ', ';charset=utf-8']) {
      it(`falls back to opaque bytes for ${JSON.stringify(value)}`, () => {
        expect(storageMimeType(value)).toBe(INERT_MIME_TYPE);
      });
    }
  });
});

describe('isPreviewableImage', () => {
  it('accepts an ordinary image', () => {
    expect(isPreviewableImage('image/png')).toBe(true);
  });

  // Asked of the *stored* type, so a neutralised SVG is never handed to the image decoder — which
  // also keeps sharp from rasterising an XML document that may reference outside itself.
  it('refuses a neutralised file, which is what an SVG becomes', () => {
    expect(isPreviewableImage(storageMimeType('image/svg+xml'))).toBe(false);
  });

  it('refuses a document', () => {
    expect(isPreviewableImage('application/pdf')).toBe(false);
  });
});
