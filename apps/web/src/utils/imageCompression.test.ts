import { describe, it, expect } from 'vitest';
import { fitWithin, isCompressible, MAX_PHOTO_EDGE } from './imageCompression';

const file = (type: string, name = 'x') => ({ type, name }) as File;

describe('fitWithin', () => {
  it('leaves an image already within the cap alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  // Enlarging would grow the file while adding nothing.
  it('never enlarges', () => {
    expect(fitWithin(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it('scales the longest edge down to the cap', () => {
    expect(fitWithin(4096, 2048)).toEqual({ width: MAX_PHOTO_EDGE, height: 1024 });
  });

  it('uses the longest edge whichever way round the image is', () => {
    expect(fitWithin(2048, 4096)).toEqual({ width: 1024, height: MAX_PHOTO_EDGE });
  });

  // Whole pixels cannot hold a ratio exactly — 6000x4000 caps to 2048x1365, which is 1.5004 —
  // so this checks the shape is preserved to the pixel, not to the decimal.
  it('keeps the shape', () => {
    const { width, height } = fitWithin(6000, 4000);
    expect(width / height).toBeCloseTo(6000 / 4000, 2);
    expect(Math.abs(height - Math.round(width / (6000 / 4000)))).toBeLessThanOrEqual(1);
  });

  it('handles an exactly-capped image without touching it', () => {
    expect(fitWithin(MAX_PHOTO_EDGE, 100)).toEqual({ width: MAX_PHOTO_EDGE, height: 100 });
  });

  // A canvas of zero width throws, so a sliver must still round to one pixel.
  it('never rounds an edge away to nothing', () => {
    expect(fitWithin(20000, 1).height).toBe(1);
  });

  it('tolerates a zero dimension rather than dividing by it', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('isCompressible', () => {
  it('accepts ordinary photo formats', () => {
    expect(isCompressible(file('image/jpeg'))).toBe(true);
    expect(isCompressible(file('image/png'))).toBe(true);
    expect(isCompressible(file('image/webp'))).toBe(true);
  });

  // Only the first frame survives a canvas, so a GIF must be sent untouched.
  it('refuses a GIF, which would lose its animation', () => {
    expect(isCompressible(file('image/gif'))).toBe(false);
  });

  it('refuses anything that is not an image', () => {
    expect(isCompressible(file('video/mp4'))).toBe(false);
    expect(isCompressible(file('application/pdf'))).toBe(false);
  });
});
