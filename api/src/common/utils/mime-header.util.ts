/**
 * Decodes RFC 2047 "encoded words" in a mail header.
 *
 * Found on stage (2026-10-22): every row in the inbound log showed its subject
 * as `=?UTF-8?Q?Proposed_new_time=3A_Community...` rather than "Proposed new
 * time: Community…". Any header carrying a non-ASCII character — or, as here, a
 * sender that encodes pre-emptively — arrives in this form, so a log that shows
 * the raw header is unreadable exactly when the subject matters.
 *
 * Pure and dependency-free, like `ical-extract.util.ts` beside it, so the rule
 * can be pinned by unit tests. Header decoding is a place where "nearly right"
 * fails on a specific sender rather than in general, which is the same trap
 * `v2-33`'s #45 fell into.
 */

/**
 * `_` means a space in Q-encoding and **only** in Q-encoding.
 *
 * This is the detail that makes a hand-rolled decoder wrong on real mail:
 * quoted-printable proper has no such rule, so reusing a QP decoder as-is turns
 * "Proposed_new_time" into "Proposed_new_time" rather than "Proposed new time".
 */
function decodeQEncoding(text: string): string {
  const withSpaces = text.replace(/_/g, ' ');
  // Runs of escapes are decoded together, as bytes: a UTF-8 character spans
  // several escapes ("é" is "=C3=A9"), and decoding each one separately would
  // produce mojibake ("Ã©"). Same reasoning as decodeQuotedPrintable.
  return withSpaces.replace(/(?:=[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = run
      .split('=')
      .filter(Boolean)
      .map((hex) => parseInt(hex, 16));
    return Buffer.from(bytes).toString('utf8');
  });
}

function decodeBEncoding(text: string): string {
  try {
    return Buffer.from(text, 'base64').toString('utf8');
  } catch {
    return text;
  }
}

/**
 * Turn any encoded words in a header value into text.
 *
 * Leaves a header with no encoded words untouched, which is most of them, and
 * never throws: this runs while recording a *log*, so a header it cannot parse
 * must degrade to the raw value rather than cost the row.
 *
 * Adjacent encoded words separated only by whitespace are joined with none,
 * per RFC 2047 — senders split a long subject across several words, and keeping
 * the separator inserts spaces that were never in the subject.
 */
export function decodeEncodedWords(value: string): string {
  if (!value.includes('=?')) return value;

  try {
    // Collapse the whitespace between two adjacent encoded words first, so the
    // pass below sees them as neighbours.
    const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2');

    return joined.replace(
      /=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g,
      (_match, _charset: string, encoding: string, text: string) =>
        encoding.toUpperCase() === 'B' ? decodeBEncoding(text) : decodeQEncoding(text),
    );
  } catch {
    return value;
  }
}
