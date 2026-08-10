/**
 * Mentions are stored as plain "@username" inside the message body.
 *
 * Not as markup carrying a user id: the body is the text a person typed, and everything that
 * reads it — search, the conversation-list preview, a desktop notification, the day a client
 * exists that does not understand mentions — would otherwise show the markup instead of the
 * words. The cost is that a mention is resolved by name at render time, so renaming someone
 * leaves older mentions pointing at a name nobody has; that is a fair trade for a body that
 * always reads as what was written.
 */

/**
 * Matches "@" followed by a username, when the "@" begins a word.
 *
 * The leading boundary stops an email address becoming a mention of its domain — "a@example.com"
 * must not mention "example". Usernames here are letters, digits, dot, dash and underscore.
 */
const MENTION_PATTERN = /(^|[^\w@])@([a-zA-Z0-9._-]+)/g;

/** Every username mentioned in the text, lowercased, without duplicates. */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    found.add(match[2].toLowerCase());
  }
  return [...found];
}

/**
 * Whether `username` is mentioned.
 *
 * Case-insensitive, because nobody types a colleague's capitalisation carefully and being missed
 * by a mention is worse than catching one loosely.
 */
export function mentions(text: string, username: string | undefined | null): boolean {
  if (!username) return false;
  return extractMentions(text).includes(username.toLowerCase());
}

export type MentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string; username: string; known: boolean };

/**
 * Split text into plain runs and mentions, so a renderer can style the mentions without having to
 * parse anything itself.
 *
 * A mention of someone not in `knownUsernames` is still returned, marked unknown: "@lunch" in the
 * middle of a sentence should read as the word it is, not as a highlighted link to nobody.
 */
export function segmentMentions(text: string, knownUsernames: Iterable<string>): MentionSegment[] {
  const known = new Set([...knownUsernames].map((u) => u.toLowerCase()));
  const segments: MentionSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MENTION_PATTERN)) {
    const lead = match[1] ?? '';
    // matchAll gives the index of the whole match, which includes the character before the "@".
    const at = (match.index ?? 0) + lead.length;
    if (at > cursor) segments.push({ kind: 'text', value: text.slice(cursor, at) });

    const username = match[2];
    segments.push({
      kind: 'mention',
      value: `@${username}`,
      username: username.toLowerCase(),
      known: known.has(username.toLowerCase()),
    });
    cursor = at + username.length + 1;
  }

  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  return segments;
}
