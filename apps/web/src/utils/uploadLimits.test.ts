import { describe, it, expect } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentTooLargeMessage,
  formatLimit,
} from './uploadLimits';

const MB = 1024 * 1024;

describe('formatLimit', () => {
  it('writes a whole number of megabytes without a decimal', () => {
    expect(formatLimit(50 * MB)).toBe('50 MB');
  });

  it('gives one decimal place to a fractional size', () => {
    expect(formatLimit(4.25 * MB)).toBe('4.3 MB');
  });

  it('drops to kilobytes below a megabyte', () => {
    expect(formatLimit(900 * 1024)).toBe('900 KB');
  });
});

describe('attachmentTooLargeMessage', () => {
  it('passes a file within the limit', () => {
    expect(attachmentTooLargeMessage({ name: 'a.png', size: 2 * MB })).toBeNull();
  });

  // The limit is inclusive on the server — a file of exactly the maximum is accepted, so the
  // client must not refuse it first.
  it('passes a file of exactly the limit', () => {
    expect(attachmentTooLargeMessage({ name: 'a.png', size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it('refuses one byte over', () => {
    expect(attachmentTooLargeMessage({ name: 'a.png', size: MAX_ATTACHMENT_BYTES + 1 })).not.toBeNull();
  });

  it('names the file, its size and the limit', () => {
    const msg = attachmentTooLargeMessage({ name: 'holiday.mov', size: 120 * MB });
    expect(msg).toContain('holiday.mov');
    expect(msg).toContain('120 MB');
    expect(msg).toContain('50 MB');
  });

  // A pasted image or a recorded voice note arrives as a Blob with no name.
  it('reads sensibly when the file has no name', () => {
    const msg = attachmentTooLargeMessage({ size: 120 * MB });
    expect(msg).toContain('That file is');
    expect(msg).not.toContain('undefined');
  });

  it('takes a different limit for avatars', () => {
    expect(attachmentTooLargeMessage({ name: 'me.png', size: 6 * MB }, 5 * MB)).toContain('5 MB');
    expect(attachmentTooLargeMessage({ name: 'me.png', size: 4 * MB }, 5 * MB)).toBeNull();
  });
});
