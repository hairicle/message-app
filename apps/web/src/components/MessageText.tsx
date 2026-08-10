import { Fragment } from 'react';
import { Linkify } from './Linkify';
import { segmentMentions } from '../utils/mentions';

interface MessageTextProps {
  text: string;
  /** Usernames in this conversation; anyone else's "@name" stays plain text. */
  usernames: string[];
  /** The reader's own username, so their own mentions can stand out from the rest. */
  currentUsername?: string;
  linkStyle?: React.CSSProperties;
  /** Colour for a mention of someone else. */
  mentionStyle?: React.CSSProperties;
  /** Colour for a mention of the reader, which should be findable at a glance. */
  selfMentionStyle?: React.CSSProperties;
}

/**
 * A message body: mentions highlighted, URLs linked, everything else left alone.
 *
 * Mentions are split out first and the runs between them handed to Linkify, rather than teaching
 * one regex to do both. A URL can contain an "@" and a mention can sit against punctuation, so a
 * combined pattern gets the boundaries wrong in one direction or the other.
 */
export function MessageText({
  text,
  usernames,
  currentUsername,
  linkStyle,
  mentionStyle,
  selfMentionStyle,
}: MessageTextProps) {
  const segments = segmentMentions(text, usernames);

  // Nothing to highlight — hand the whole body straight to Linkify.
  if (segments.every((s) => s.kind === 'text')) {
    return <Linkify text={text} linkStyle={linkStyle} />;
  }

  const me = currentUsername?.toLowerCase();

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'text') {
          return <Linkify key={i} text={segment.value} linkStyle={linkStyle} />;
        }
        // Someone outside the conversation: "@lunch" is a word, not a person.
        if (!segment.known) {
          return <Fragment key={i}>{segment.value}</Fragment>;
        }
        const isMe = !!me && segment.username === me;
        return (
          <span
            key={i}
            className={isMe ? 'font-semibold rounded px-0.5' : 'font-medium'}
            style={isMe ? selfMentionStyle : mentionStyle}
          >
            {segment.value}
          </span>
        );
      })}
    </>
  );
}
