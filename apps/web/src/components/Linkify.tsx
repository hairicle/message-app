import { Fragment } from 'react';

// Matches http(s):// and www.-prefixed URLs; trims trailing sentence punctuation
// that's almost never actually part of the link (e.g. "check this out: https://x.com.")
const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/;

interface LinkifyProps {
  text: string;
  linkClassName?: string;
  linkStyle?: React.CSSProperties;
}

/** Renders plain text with any URLs turned into clickable links, everything else left as-is. */
export function Linkify({ text, linkClassName, linkStyle }: LinkifyProps) {
  // With a single capture group, String.split(regex) alternates [text, match, text, match, ...] —
  // odd indices are always the captured URLs, even indices are the plain text between them.
  const parts = text.split(URL_PATTERN);
  if (parts.length === 1) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? <Fragment key={i}>{part}</Fragment> : null;
        }

        const trailingMatch = part.match(TRAILING_PUNCTUATION);
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const url = trailing ? part.slice(0, -trailing.length) : part;
        const href = url.startsWith('http') ? url : `https://${url}`;

        return (
          <Fragment key={i}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={linkClassName}
              // `overflow-wrap: break-word` (not `word-break: break-all`): long URLs still wrap
              // rather than overflow, but the break opportunities are excluded from min-content
              // sizing — so a shrink-to-fit bubble can't collapse to one character per line.
              style={{ textDecoration: 'underline', overflowWrap: 'break-word', ...linkStyle }}
            >
              {url}
            </a>
            {trailing}
          </Fragment>
        );
      })}
    </>
  );
}
