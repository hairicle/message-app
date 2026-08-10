import { describe, it, expect } from 'vitest';
import type { Message } from '@messenger/shared';
import { buildAlbums, ALBUM_WINDOW_MS } from './messageAlbums';

const START = new Date(2026, 7, 7, 10, 0, 0).getTime();
const at = (secondsFromStart: number) => new Date(START + secondsFromStart * 1000).toISOString();

let seq = 0;
const media = (sender: string, seconds: number, over: Partial<Message> = {}): Message => ({
  id: `m${seq++}`,
  senderId: sender,
  type: 'image',
  createdAt: at(seconds),
  file: { id: `f${seq}`, fileName: 'p.png' },
  ...over,
}) as Message;

const text = (sender: string, seconds: number): Message =>
  ({ id: `t${seq++}`, senderId: sender, type: 'text', createdAt: at(seconds), ciphertext: '' }) as Message;

const albumSizes = (messages: Message[]) =>
  [...buildAlbums(messages).albums.values()].map((run) => run.length);

describe('buildAlbums', () => {
  it('groups media sent together by one person', () => {
    const thread = [media('a', 0), media('a', 2), media('a', 4)];
    expect(albumSizes(thread)).toEqual([3]);
    expect(buildAlbums(thread).absorbed.size).toBe(2);
  });

  it('leaves a lone image alone', () => {
    expect(albumSizes([media('a', 0)])).toEqual([]);
  });

  it('does not group across a change of sender', () => {
    expect(albumSizes([media('a', 0), media('b', 2), media('a', 4)])).toEqual([]);
  });

  it('does not group media separated by more than the window', () => {
    expect(albumSizes([media('a', 0), media('a', ALBUM_WINDOW_MS / 1000 + 5)])).toEqual([]);
  });

  it('breaks a run where a text message interrupts it', () => {
    const thread = [media('a', 0), media('a', 2), text('a', 3), media('a', 4), media('a', 5)];
    expect(albumSizes(thread)).toEqual([2, 2]);
  });

  it('mixes images and video in one album', () => {
    const thread = [media('a', 0), media('a', 1, { type: 'video' })];
    expect(albumSizes(thread)).toEqual([2]);
  });

  // Both carry context a bare tile has nowhere to show.
  it('never absorbs a reply', () => {
    const thread = [media('a', 0), media('a', 1, { replyToMessageId: 'x' }), media('a', 2)];
    expect(albumSizes(thread)).toEqual([]);
  });

  it('never absorbs a forwarded image', () => {
    const thread = [media('a', 0), media('a', 1, { forwardedFromMessageId: 'x' })];
    expect(albumSizes(thread)).toEqual([]);
  });

  it('skips a deleted image', () => {
    const thread = [media('a', 0), media('a', 1, { deletedAt: at(5) }), media('a', 2)];
    expect(albumSizes(thread)).toEqual([]);
  });

  it('skips an image whose file is missing', () => {
    const thread = [media('a', 0), media('a', 1, { file: undefined }), media('a', 2)];
    expect(albumSizes(thread)).toEqual([]);
  });

  it('keys the album by its first message and absorbs only the rest', () => {
    const thread = [media('a', 0), media('a', 1), media('a', 2)];
    const { albums, absorbed } = buildAlbums(thread);
    expect([...albums.keys()]).toEqual([thread[0].id]);
    expect(absorbed.has(thread[0].id)).toBe(false);
    expect(absorbed.has(thread[1].id)).toBe(true);
    expect(absorbed.has(thread[2].id)).toBe(true);
  });

  it('handles several albums in one thread', () => {
    const thread = [
      media('a', 0), media('a', 1),
      text('b', 30),
      media('b', 40), media('b', 41), media('b', 42),
    ];
    expect(albumSizes(thread)).toEqual([2, 3]);
  });

  it('returns nothing for an empty thread', () => {
    expect(buildAlbums([]).albums.size).toBe(0);
  });
});
