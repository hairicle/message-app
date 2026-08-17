/**
 * Who should be notified about a message, and on which devices.
 *
 * Separated from the query and the sending so the rule can be read and tested on its own. Deciding
 * *not* to notify someone is as important as deciding to: a notification nobody wanted is how an
 * app ends up silenced entirely, and then the ones that mattered are lost too.
 */

export interface CandidateDevice {
  userId: string;
  deviceId: string;
  pushToken: string;
}

export interface MemberState {
  userId: string;
  /** When their mute expires, or null if they have not muted this conversation. */
  mutedUntil: Date | null;
  /** Their `push_enabled` preference; absent means they have no preferences row yet. */
  pushEnabled: boolean | null;
}

export interface PushTarget {
  userId: string;
  deviceId: string;
  pushToken: string;
}

/**
 * The devices to send to.
 *
 * Four reasons not to send, and each is someone's explicit choice or an obvious mistake:
 *
 * - **The sender.** Their own message is not news to them, and their phone buzzing in their hand as
 *   they send is the single most irritating bug this feature can have.
 * - **A muted conversation**, while the mute is still running. Stored as the moment it ends rather
 *   than a flag, so an expired mute needs no job to undo it — it simply stops being in the future.
 * - **Push turned off.** Defaulting to on when there is no preferences row, which matches the
 *   column default and means an account that has never opened settings still gets messages.
 * - **No token.** A browser-only session has a device row and no token; there is nothing to send to.
 */
export function pushTargets(
  devices: CandidateDevice[],
  members: MemberState[],
  senderId: string | null,
  now: Date = new Date(),
): PushTarget[] {
  const byUser = new Map(members.map((m) => [m.userId, m]));

  return devices.filter((device) => {
    if (device.userId === senderId) return false;
    if (!device.pushToken) return false;

    const member = byUser.get(device.userId);
    // Not a member of the conversation. Should not happen, and silently not notifying is the right
    // way for it not to happen.
    if (!member) return false;

    if (member.pushEnabled === false) return false;
    if (member.mutedUntil && member.mutedUntil.getTime() > now.getTime()) return false;

    return true;
  });
}

/**
 * What the notification says.
 *
 * **Deliberately not the message text.** Bodies are encrypted at rest precisely so that the
 * database does not hand them over; putting the plaintext through a third-party push service and
 * onto a lock screen gives away much of that, to anyone who picks the phone up as well as to the
 * service carrying it.
 *
 * The sender's name and the conversation are enough to decide whether to look, which is all a
 * notification is for. The app fetches the message itself once opened, over the same authenticated
 * connection everything else uses.
 *
 * If this is ever loosened it should be a per-person preference with this as the default, not a
 * change of mind about the default.
 */
export function pushPayload(input: {
  senderName: string;
  conversationId: string;
  conversationName: string | null;
  messageId: string;
  type: string;
}): { title: string; body: string; data: Record<string, string> } {
  const inGroup = !!input.conversationName;
  return {
    title: inGroup ? input.conversationName! : input.senderName,
    // Named in the body for a group, because the title is the group and the reader still needs to
    // know who spoke. In a direct conversation the title is already the person.
    body: describe(input.type, inGroup ? input.senderName : null),
    data: {
      conversationId: input.conversationId,
      messageId: input.messageId,
    },
  };
}

/** What kind of message arrived, without saying what it said. */
function describe(type: string, senderName: string | null): string {
  const what = type === 'text' ? 'Sent a message'
    : type === 'image' ? 'Sent a photo'
      : type === 'video' ? 'Sent a video'
        : type === 'audio' ? 'Sent a voice note'
          : 'Sent a file';
  return senderName ? `${senderName}: ${what.replace('Sent', 'sent')}` : what;
}
