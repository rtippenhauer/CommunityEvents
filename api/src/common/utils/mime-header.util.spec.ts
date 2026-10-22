import { describe, expect, it } from 'vitest';
import { decodeEncodedWords } from './mime-header.util';

/**
 * Found on stage, 2026-10-22: every inbound log row showed its subject as the
 * raw encoded word. The real values, copied from the live rows, are the fixtures
 * here — a decoder written against invented examples is how "nearly right"
 * ships.
 */
describe('decodeEncodedWords', () => {
  it('decodes the subject that was unreadable on stage', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Proposed_new_time=3A_Community_Events?=')).toBe(
      'Proposed new time: Community Events',
    );
  });

  it('decodes an Accepted subject, the ordinary case', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Accepted=3A_Community_Events_Project?=')).toBe(
      'Accepted: Community Events Project',
    );
  });

  /**
   * The rule a hand-rolled decoder gets wrong: `_` is a space in Q-encoding and
   * nowhere else, so reusing a quoted-printable decoder leaves the underscores
   * in place and the subject still reads wrong.
   */
  it('treats underscore as a space, which plain quoted-printable does not', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?one_two_three?=')).toBe('one two three');
  });

  it('decodes a multi-byte character from its run of escapes', () => {
    // "Larry Martín" — the UTF-8 for í spans two escapes and must decode as one
    // character, not two. Decoding each escape alone gives "MartÃ­n".
    expect(decodeEncodedWords('=?UTF-8?Q?Larry_Mart=C3=ADn?=')).toBe('Larry Martín');
  });

  it('decodes base64 encoded words', () => {
    expect(decodeEncodedWords('=?UTF-8?B?QWNjZXB0ZWQ6IERpbm5lcg==?=')).toBe('Accepted: Dinner');
  });

  /**
   * Senders split a long subject across several encoded words. RFC 2047 says the
   * whitespace between two adjacent ones is not part of the text, so keeping it
   * inserts spaces the subject never had.
   */
  it('joins adjacent encoded words without inserting a space', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Accepted=3A_Comm?= =?UTF-8?Q?unity_Dinner?=')).toBe(
      'Accepted: Community Dinner',
    );
  });

  it('keeps the space between an encoded word and ordinary text', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Re=3A?= plain tail')).toBe('Re: plain tail');
  });

  it('leaves a header with no encoded words exactly as it is', () => {
    // Including one that merely contains an "=" — a decoder that pattern-matched
    // too loosely would mangle an ordinary subject.
    expect(decodeEncodedWords('Accepted: Dinner 7=8 people')).toBe('Accepted: Dinner 7=8 people');
    expect(decodeEncodedWords('Larry <larry@example.test>')).toBe('Larry <larry@example.test>');
  });

  it('degrades to the raw value rather than throwing on nonsense', () => {
    // This runs while writing a log row: an unparseable header must cost the
    // readability of one field, never the row.
    expect(() => decodeEncodedWords('=?UTF-8?X?unknown-encoding?=')).not.toThrow();
    expect(decodeEncodedWords('=?broken')).toBe('=?broken');
  });
});
