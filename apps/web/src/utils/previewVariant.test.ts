import { describe, it, expect } from 'vitest';
import type { FileMeta } from '@messenger/shared';
import { previewVariant } from './previewVariant';

const file = (over: Partial<FileMeta>) => ({ hasThumbnail: true, sizeBytes: 5_000_000, ...over }) as FileMeta;

describe('previewVariant', () => {
  it('uses the preview for a large image', () => {
    expect(previewVariant(file({ sizeBytes: 5_000_000 }))).toBe('thumbnail');
  });

  // Nothing is saved by shrinking something already small, and the original is sharper.
  it('uses the original when it is already small', () => {
    expect(previewVariant(file({ sizeBytes: 120_000 }))).toBe('original');
  });

  it('uses the original when there is no preview at all', () => {
    expect(previewVariant(file({ hasThumbnail: false }))).toBe('original');
  });

  it('falls back to the original for a missing file', () => {
    expect(previewVariant(undefined)).toBe('original');
    expect(previewVariant(null)).toBe('original');
  });

  it('uses the preview when the size is unknown, which is the safe way round', () => {
    expect(previewVariant({ hasThumbnail: true } as FileMeta)).toBe('thumbnail');
  });

  it('treats the boundary as small enough', () => {
    expect(previewVariant(file({ sizeBytes: 600 * 1024 }))).toBe('original');
    expect(previewVariant(file({ sizeBytes: 600 * 1024 + 1 }))).toBe('thumbnail');
  });
});
