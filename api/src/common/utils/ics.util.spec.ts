import { eventTimeToUtc, foldIcsLine, icsEscape, toIcsUtcString } from './ics.util';

/**
 * RFC 5545 output. Calendar clients are unforgiving here: an unescaped comma
 * in a LOCATION or a CONTENT-LINE over 75 octets makes the whole .ics fail to
 * parse, and the member simply sees an invite that will not open — with
 * nothing logged anywhere on our side.
 */
describe('icsEscape', () => {
  it('escapes the four TEXT metacharacters', () => {
    expect(icsEscape('a,b')).toBe('a\\,b');
    expect(icsEscape('a;b')).toBe('a\\;b');
    expect(icsEscape('a\nb')).toBe('a\\nb');
    expect(icsEscape('a\\b')).toBe('a\\\\b');
  });

  it('escapes backslashes before the rest, so an escape is not double-escaped', () => {
    // Order matters: escaping commas first would turn "\," into "\\," and the
    // client would render a literal backslash.
    expect(icsEscape('a\\,b')).toBe('a\\\\\\,b');
  });

  it('leaves ordinary text alone', () => {
    expect(icsEscape("Bob's House")).toBe("Bob's House");
  });

  it('handles a realistic address', () => {
    expect(icsEscape('123 Test St, Cincinnati, OH 45202')).toBe(
      '123 Test St\\, Cincinnati\\, OH 45202',
    );
  });
});

describe('eventTimeToUtc', () => {
  // Event times are stored as Eastern wall-clock; DTSTART must be UTC.
  it('converts an EDT evening to UTC', () => {
    expect(eventTimeToUtc('2026-07-14', '18:30').toISOString()).toBe('2026-07-14T22:30:00.000Z');
  });

  it('converts an EST evening to UTC', () => {
    // Same wall clock, different offset — a hard-coded -4 would be an hour out
    // for half the year.
    expect(eventTimeToUtc('2027-01-05', '18:30').toISOString()).toBe('2027-01-05T23:30:00.000Z');
  });

  it('accepts the HH:MM:SS form the TIME column reads back as', () => {
    expect(eventTimeToUtc('2026-07-14', '18:30:00').toISOString()).toBe(
      eventTimeToUtc('2026-07-14', '18:30').toISOString(),
    );
  });

  it('handles an evening event that crosses into the next UTC day', () => {
    expect(eventTimeToUtc('2026-07-14', '21:00').toISOString()).toBe('2026-07-15T01:00:00.000Z');
  });
});

describe('toIcsUtcString', () => {
  it('formats as YYYYMMDDTHHMMSSZ', () => {
    expect(toIcsUtcString(new Date('2026-07-14T22:30:00Z'))).toBe('20260714T223000Z');
  });

  it('zero-pads every component', () => {
    expect(toIcsUtcString(new Date('2026-01-05T09:05:03Z'))).toBe('20260105T090503Z');
  });

  it('reads UTC rather than local time', () => {
    expect(toIcsUtcString(new Date('2026-07-14T00:00:00Z'))).toBe('20260714T000000Z');
  });
});

describe('foldIcsLine', () => {
  it('leaves a line at or under 75 octets untouched', () => {
    const line = 'SUMMARY:' + 'a'.repeat(67); // exactly 75
    expect(foldIcsLine(line)).toBe(line);
    expect(foldIcsLine(line)).not.toContain('\r\n');
  });

  it('folds a longer line with CRLF + a single leading space', () => {
    const folded = foldIcsLine('DESCRIPTION:' + 'a'.repeat(200));
    expect(folded).toContain('\r\n ');
    for (const segment of folded.split('\r\n ')) {
      expect(Buffer.from(segment, 'utf-8').length).toBeLessThanOrEqual(75);
    }
  });

  it('keeps continuation segments within 74 octets, since the space costs one', () => {
    const segments = foldIcsLine('DESCRIPTION:' + 'a'.repeat(300)).split('\r\n ');
    for (const segment of segments.slice(1)) {
      expect(Buffer.from(segment, 'utf-8').length).toBeLessThanOrEqual(74);
    }
  });

  it('never splits a multi-byte character across a fold', () => {
    // The emoji in event descriptions are 4-byte sequences. Splitting one
    // produces replacement characters and can break the client's parse.
    const folded = foldIcsLine('DESCRIPTION:' + '🍽'.repeat(40));
    expect(folded).not.toContain('�');
    expect(folded.split('\r\n ').join('')).toBe('DESCRIPTION:' + '🍽'.repeat(40));
  });

  it('round-trips: unfolding restores the original line exactly', () => {
    const original = 'DESCRIPTION:' + 'Dinner at Bob’s House — 123 Test St, Cincinnati '.repeat(6);
    expect(foldIcsLine(original).split('\r\n ').join('')).toBe(original);
  });
});
