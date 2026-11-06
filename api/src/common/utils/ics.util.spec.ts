import { eventTimeToUtc, foldIcsLine, icsEscape, icsSequence, toIcsUtcString } from './ics.util';

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

/** What the value was before this bug was fixed, kept so the regression is shown rather than described. */
const wrappingSequence = (at: Date) => Math.floor(at.getTime() / 1000) % 999999;

describe('icsSequence', () => {
  it('increases as time passes', () => {
    const first = icsSequence(new Date('2026-11-05T12:00:00Z'));
    const second = icsSequence(new Date('2026-11-05T12:00:01Z'));

    expect(second).toBeGreaterThan(first);
  });

  it('never goes backwards across the window where the old formula wrapped', () => {
    // 999999 seconds is 11 days 13 hours 46 minutes 39 seconds. The old value
    // was seconds-since-epoch modulo that, so it returned to zero on every such
    // boundary and the invite after a wrap carried a LOWER SEQUENCE than the one
    // the member's calendar already held — which a client discards in silence,
    // keeping its stale copy.
    //
    // Two seconds apart, straddling the next boundary after an arbitrary date:
    // spanning a whole period instead would land on the same value, not a lower
    // one, which is how this looks fine until it is drawn out.
    const boundarySec = Math.ceil(Date.UTC(2026, 10, 5) / 1000 / 999999) * 999999;
    const before = new Date((boundarySec - 1) * 1000);
    const after = new Date((boundarySec + 1) * 1000);

    expect(wrappingSequence(after)).toBeLessThan(wrappingSequence(before));
    expect(icsSequence(after)).toBeGreaterThan(icsSequence(before));
  });

  it('is monotonic over every wrap boundary in a year of daily sends', () => {
    const start = Date.UTC(2026, 0, 1);
    let previous = -1;

    for (let day = 0; day < 365; day++) {
      const current = icsSequence(new Date(start + day * 86400 * 1000));
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('stays inside the signed 32-bit range RFC 5545 allows for an INTEGER', () => {
    // Also a check on the choice of epoch: seconds since 1970 would already
    // overflow in 2038, which is inside the life of a deployment.
    expect(icsSequence(new Date('2087-12-31T23:59:59Z'))).toBeLessThan(2147483647);
  });

  it('is never negative for a date before its epoch', () => {
    // A SEQUENCE must be a non-negative INTEGER. Nothing should produce a date
    // this old, but a bad import or a clock skewed backwards would.
    expect(icsSequence(new Date('2019-01-01T00:00:00Z'))).toBe(0);
  });
});
