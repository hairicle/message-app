import { describe, it, expect } from 'vitest';
import { messagePreview, attachmentPhrase, attachmentNoun } from './messagePreview';

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

describe('messagePreview', () => {
  it('keeps the "Name: message" shape for text', () => {
    expect(messagePreview({ type: 'text', ciphertext: b64('see you at 3'), senderName: 'Admin' }))
      .toBe('Admin: see you at 3');
  });

  // The regression this guards: attachments previewed as "Admin: 📷", leaving the reader to
  // decode an emoji.
  it('describes attachments as a sentence instead of an icon', () => {
    const cases: [string, string][] = [
      ['image', 'Admin sent a photo'],
      ['video', 'Admin sent a video'],
      ['audio', 'Admin sent a voice message'],
      ['file', 'Admin sent a file'],
    ];
    for (const [type, expected] of cases) {
      expect(messagePreview({ type, ciphertext: '', senderName: 'Admin' })).toBe(expected);
    }
  });

  it('drops the colon for attachments, since the sender is the subject', () => {
    const out = messagePreview({ type: 'image', ciphertext: '', senderName: 'Admin' });
    expect(out).not.toContain(':');
  });

  it('never produces "a image"', () => {
    for (const type of ['image', 'video', 'audio', 'file', 'something-else']) {
      expect(messagePreview({ type, ciphertext: '', senderName: 'A' })).not.toMatch(/\ba (image|attachment|a[eiou])/);
    }
  });

  it('falls back for an unknown type rather than showing it raw', () => {
    expect(messagePreview({ type: 'hologram', ciphertext: '', senderName: 'Admin' }))
      .toBe('Admin sent an attachment');
  });

  it('capitalises when there is no sender, as in a notification body', () => {
    // The notification title is already the sender's name.
    expect(messagePreview({ type: 'image', ciphertext: '' })).toBe('Sent a photo');
    expect(messagePreview({ type: 'text', ciphertext: b64('hi') })).toBe('hi');
  });

  it('reports a deleted message regardless of its original type', () => {
    expect(messagePreview({ type: 'image', ciphertext: '', senderName: 'Admin', deleted: true }))
      .toBe('Admin: Message deleted');
    expect(messagePreview({ type: 'text', ciphertext: b64('secret'), senderName: 'Admin', deleted: true }))
      .toBe('Admin: Message deleted');
  });

  it('does not leak a deleted message\'s body', () => {
    const out = messagePreview({ type: 'text', ciphertext: b64('secret'), senderName: 'A', deleted: true });
    expect(out).not.toContain('secret');
  });

  it('decodes non-Latin text', () => {
    expect(messagePreview({ type: 'text', ciphertext: b64('សួស្តី'), senderName: 'នី' })).toBe('នី: សួស្តី');
  });

  it('handles a missing sender name', () => {
    expect(messagePreview({ type: 'text', ciphertext: b64('hi'), senderName: null })).toBe('hi');
    expect(messagePreview({ type: 'text', ciphertext: b64('hi'), senderName: '   ' })).toBe('hi');
  });
});

describe('attachment wording', () => {
  it('pairs each phrase with a matching noun', () => {
    expect(attachmentPhrase('image')).toBe('sent a photo');
    expect(attachmentNoun('image')).toBe('Photo');
    expect(attachmentNoun('audio')).toBe('Voice message');
  });

  it('has a fallback for both', () => {
    expect(attachmentPhrase('unknown')).toBe('sent an attachment');
    expect(attachmentNoun('unknown')).toBe('Attachment');
  });
});
