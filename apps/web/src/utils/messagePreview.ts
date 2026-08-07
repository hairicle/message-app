import { decodeMessageText } from './text';

/**
 * How a non-text message is described when its contents cannot be shown — conversation list
 * previews, desktop notifications, and anywhere else a one-line summary is needed.
 *
 * These read as sentences rather than bare labels: a row saying "Admin sent a photo" tells you
 * what happened, where "Admin: 📷" makes you decode an icon.
 */
const ATTACHMENT_PHRASE: Record<string, string> = {
  image: 'sent a photo',
  video: 'sent a video',
  audio: 'sent a voice message',
  file: 'sent a file',
};

/** Short noun for the same types, for contexts that already say who did it. */
const ATTACHMENT_NOUN: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  file: 'File',
};

export function attachmentPhrase(type: string): string {
  return ATTACHMENT_PHRASE[type] ?? 'sent an attachment';
}

export function attachmentNoun(type: string): string {
  return ATTACHMENT_NOUN[type] ?? 'Attachment';
}

/**
 * One-line summary of a message for a list row.
 *
 * Text keeps the familiar "Name: message" shape. Attachments read as "Name sent a photo" — with
 * no colon, because the sender is the subject of the sentence rather than a label for it.
 */
export function messagePreview(input: {
  type: string;
  ciphertext: string;
  senderName?: string | null;
  deleted?: boolean;
}): string {
  const name = input.senderName?.trim();

  if (input.deleted) return name ? `${name}: Message deleted` : 'Message deleted';

  if (input.type !== 'text') {
    const phrase = attachmentPhrase(input.type);
    return name ? `${name} ${phrase}` : phrase.replace(/^sent /, 'Sent ');
  }

  const body = decodeMessageText(input.ciphertext);
  return name ? `${name}: ${body}` : body;
}
