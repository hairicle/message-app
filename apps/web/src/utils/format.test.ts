import { describe, it, expect } from 'vitest';
import { formatFileSize } from './format';

describe('formatFileSize', () => {
  it('shows raw bytes below 1 KiB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('switches unit exactly at each 1024 boundary', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('keeps one decimal place', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('has no ceiling — the 50MB upload cap still renders sensibly', () => {
    expect(formatFileSize(50 * 1024 * 1024)).toBe('50.0 MB');
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1024.0 MB');
  });
});
