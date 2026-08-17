import { describe, it, expect } from 'vitest';
import { pushPayload, pushTargets, type CandidateDevice, type MemberState } from './push-recipients';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const CARLA = 'user-carla';

const device = (userId: string, deviceId = `${userId}-phone`): CandidateDevice =>
  ({ userId, deviceId, pushToken: `token-${deviceId}` });

const member = (userId: string, over: Partial<MemberState> = {}): MemberState =>
  ({ userId, mutedUntil: null, pushEnabled: true, ...over });

const NOW = new Date('2026-08-12T10:00:00Z');
const later = (mins: number) => new Date(NOW.getTime() + mins * 60_000);
const earlier = (mins: number) => new Date(NOW.getTime() - mins * 60_000);

describe('pushTargets', () => {
  it('notifies the other members of a conversation', () => {
    const out = pushTargets([device(BOB), device(CARLA)], [member(ALICE), member(BOB), member(CARLA)], ALICE, NOW);
    expect(out.map((t) => t.userId).sort()).toEqual([BOB, CARLA]);
  });

  // The most irritating bug this feature can have: a phone buzzing in the hand that just sent.
  it('never notifies the sender', () => {
    const out = pushTargets([device(ALICE), device(BOB)], [member(ALICE), member(BOB)], ALICE, NOW);
    expect(out.map((t) => t.userId)).toEqual([BOB]);
  });

  it('notifies every device a person has', () => {
    const out = pushTargets(
      [device(BOB, 'bob-phone'), device(BOB, 'bob-tablet')],
      [member(ALICE), member(BOB)], ALICE, NOW,
    );
    expect(out.map((t) => t.deviceId).sort()).toEqual(['bob-phone', 'bob-tablet']);
  });

  describe('a muted conversation', () => {
    it('is silent while the mute is running', () => {
      const out = pushTargets([device(BOB)], [member(ALICE), member(BOB, { mutedUntil: later(60) })], ALICE, NOW);
      expect(out).toEqual([]);
    });

    // Mute is stored as the moment it ends rather than a flag, so an expired one needs no job to
    // undo it — it simply stops being in the future.
    it('notifies again once the mute has passed', () => {
      const out = pushTargets([device(BOB)], [member(ALICE), member(BOB, { mutedUntil: earlier(1) })], ALICE, NOW);
      expect(out.map((t) => t.userId)).toEqual([BOB]);
    });

    it('silences only the person who muted it', () => {
      const out = pushTargets(
        [device(BOB), device(CARLA)],
        [member(ALICE), member(BOB, { mutedUntil: later(60) }), member(CARLA)],
        ALICE, NOW,
      );
      expect(out.map((t) => t.userId)).toEqual([CARLA]);
    });
  });

  describe('the push preference', () => {
    it('is respected when turned off', () => {
      const out = pushTargets([device(BOB)], [member(ALICE), member(BOB, { pushEnabled: false })], ALICE, NOW);
      expect(out).toEqual([]);
    });

    // Matching the column default, so an account that has never opened settings still gets messages.
    it('defaults to on when the person has no preferences row', () => {
      const out = pushTargets([device(BOB)], [member(ALICE), member(BOB, { pushEnabled: null })], ALICE, NOW);
      expect(out.map((t) => t.userId)).toEqual([BOB]);
    });
  });

  it('ignores a device with no token', () => {
    const out = pushTargets(
      [{ userId: BOB, deviceId: 'browser', pushToken: '' }],
      [member(ALICE), member(BOB)], ALICE, NOW,
    );
    expect(out).toEqual([]);
  });

  // Should not happen, and silently not notifying is the right way for it not to happen.
  it('ignores a device whose owner is not in the conversation', () => {
    const out = pushTargets([device(CARLA)], [member(ALICE), member(BOB)], ALICE, NOW);
    expect(out).toEqual([]);
  });

  it('notifies everyone when the sender is unknown, as a system message has none', () => {
    const out = pushTargets([device(ALICE), device(BOB)], [member(ALICE), member(BOB)], null, NOW);
    expect(out).toHaveLength(2);
  });
});

describe('pushPayload', () => {
  const base = { senderName: 'Ann', conversationId: 'c1', messageId: 'm1', type: 'text' };

  // The decision this whole feature turns on. Bodies are encrypted at rest precisely so the
  // database does not hand them over; putting the plaintext through a third-party push service and
  // onto a lock screen gives away much of that.
  it('never carries the message text', () => {
    const out = pushPayload({ ...base, conversationName: null });
    const everything = JSON.stringify(out);
    expect(everything).not.toContain('ciphertext');
    expect(Object.keys(out.data)).toEqual(['conversationId', 'messageId']);
  });

  it('carries enough to open the right conversation', () => {
    const out = pushPayload({ ...base, conversationName: null });
    expect(out.data).toEqual({ conversationId: 'c1', messageId: 'm1' });
  });

  describe('a direct conversation', () => {
    it('is titled with the person who sent it', () => {
      expect(pushPayload({ ...base, conversationName: null }).title).toBe('Ann');
    });

    it('does not repeat the name in the body', () => {
      expect(pushPayload({ ...base, conversationName: null }).body).toBe('Sent a message');
    });
  });

  describe('a group', () => {
    it('is titled with the group', () => {
      expect(pushPayload({ ...base, conversationName: 'Design' }).title).toBe('Design');
    });

    // The title is the group, so the reader still needs to know who spoke.
    it('names the sender in the body instead', () => {
      expect(pushPayload({ ...base, conversationName: 'Design' }).body).toBe('Ann: sent a message');
    });
  });

  describe('says what kind of thing arrived, without saying what it said', () => {
    for (const [type, expected] of [
      ['text', 'Sent a message'],
      ['image', 'Sent a photo'],
      ['video', 'Sent a video'],
      ['audio', 'Sent a voice note'],
      ['file', 'Sent a file'],
    ] as const) {
      it(`${type} → "${expected}"`, () => {
        expect(pushPayload({ ...base, type, conversationName: null }).body).toBe(expected);
      });
    }
  });
});
