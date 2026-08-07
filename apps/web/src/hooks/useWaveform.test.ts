import { describe, it, expect } from 'vitest';
import { normalisePeaks, placeholderWaveform } from './useWaveform';

describe('normalisePeaks', () => {
  it('returns empty for empty input', () => {
    expect(normalisePeaks([])).toEqual([]);
  });

  it('keeps every value within 0..1', () => {
    const out = normalisePeaks([0, 0.01, 0.2, 0.5, 1, 4]);
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('preserves relative order — louder input stays a taller bar', () => {
    const out = normalisePeaks([0.1, 0.2, 0.3, 0.4]);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });

  // The regression this guards: normalising against the maximum let a single clipped spike
  // crush every other bar to ~0, rendering a real voice note as a flat dotted line.
  it('does not let one loud spike flatten the rest', () => {
    const quiet = Array(20).fill(0.05);
    const withSpike = normalisePeaks([...quiet, 10]);
    // The ordinary bars must stay clearly visible, not collapse toward zero.
    expect(withSpike[0]).toBeGreaterThan(0.5);
  });

  it('lifts quiet speech above a linear scale', () => {
    // A bar at 10% of the reference should render well above 10% height, because the
    // curve exists to make low-amplitude speech legible.
    const [quiet] = normalisePeaks([0.1, ...Array(19).fill(1)]);
    expect(quiet).toBeGreaterThan(0.1);
  });

  it('clamps values above the percentile reference to 1', () => {
    const out = normalisePeaks([1, 1, 1, 1, 50]);
    expect(Math.max(...out)).toBe(1);
  });

  it('survives all-silent input without producing NaN', () => {
    const out = normalisePeaks(Array(10).fill(0));
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('survives a single-element array', () => {
    const out = normalisePeaks([0.4]);
    expect(out).toHaveLength(1);
    expect(Number.isFinite(out[0])).toBe(true);
  });
});

describe('placeholderWaveform', () => {
  it('returns exactly the requested number of bars', () => {
    expect(placeholderWaveform('key', 34)).toHaveLength(34);
    expect(placeholderWaveform('key', 1)).toHaveLength(1);
    expect(placeholderWaveform('key', 0)).toHaveLength(0);
  });

  it('is deterministic — the same note never reshuffles between renders', () => {
    expect(placeholderWaveform('blob:abc', 34)).toEqual(placeholderWaveform('blob:abc', 34));
  });

  it('differs between different notes', () => {
    expect(placeholderWaveform('blob:abc', 34)).not.toEqual(placeholderWaveform('blob:xyz', 34));
  });

  it('stays within 0..1 so bar heights never overflow the strip', () => {
    const out = placeholderWaveform('blob:abc', 64);
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('is never uniformly flat — it has to read as a waveform', () => {
    const out = placeholderWaveform('blob:abc', 34);
    expect(new Set(out.map((v) => v.toFixed(3))).size).toBeGreaterThan(5);
  });
});
