import {
  eventTimeToUtc,
  eventUid,
  foldIcsLine,
  icsEscape,
  icsSequence,
  parseEventUid,
  parseSelftestUid,
  selftestUid,
  toIcsUtcString,
} from './ics.util';

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

/**
 * The two UID namespaces, and the rule that keeps them apart (v2-48).
 *
 * This is the pair of functions the mail-chain self-test hangs off, and the
 * failure mode if they blur is not cosmetic: a self-test UID mistaken for an
 * event would write an RSVP against whatever number it parsed out, putting a
 * test into a real attendee list — and an event UID mistaken for a self-test
 * would silently discard a member's RSVP and move an operator's test to
 * "passed" instead.
 */
describe('selftestUid / parseSelftestUid', () => {
  it('round-trips a nonce', () => {
    const nonce = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(parseSelftestUid(`UID:${selftestUid(nonce)}`)).toBe(nonce);
  });

  it('uses the deployment domain, not a community one', () => {
    // Deliberately the same choice `eventUid` makes: a UID must stay stable
    // for the life of the entry, and a community can change its domain. The
    // tenant's own host is shown in the invite's title instead.
    expect(selftestUid('abc123de')).toBe(
      'communityevents-selftest-abc123de@communityeventsproject.com',
    );
  });

  it('finds the nonce inside a whole iCalendar body', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'METHOD:REPLY',
      'BEGIN:VEVENT',
      `UID:${selftestUid('deadbeefdeadbeef')}`,
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:admin@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseSelftestUid(ical)).toBe('deadbeefdeadbeef');
  });

  it('is case-insensitive on the UID and normalises the nonce', () => {
    // Some clients upper-case header names, and a few echo the UID's case.
    // The nonce is compared against a stored lower-case hex string, so it is
    // normalised here rather than at the three call sites.
    expect(parseSelftestUid('uid:COMMUNITYEVENTS-SELFTEST-ABCDEF01@COMMUNITYEVENTSPROJECT.COM')).toBe(
      'abcdef01',
    );
  });

  it('does not match an event UID', () => {
    expect(parseSelftestUid(`UID:${eventUid(42)}`)).toBeNull();
    expect(parseSelftestUid('UID:dinnerbears-event-42@dinnerbears.com')).toBeNull();
  });

  it('does not match a nonce shape this code never emits', () => {
    // Narrow on purpose, like parseEventUid's two spelled-out alternatives: a
    // loose `.+` would accept anything at all in the nonce position and hand
    // it to a database lookup.
    expect(parseSelftestUid('UID:communityevents-selftest-@communityeventsproject.com')).toBeNull();
    expect(
      parseSelftestUid('UID:communityevents-selftest-not-hex!@communityeventsproject.com'),
    ).toBeNull();
    expect(parseSelftestUid('UID:communityevents-selftest-abc@example.com')).toBeNull();
  });

  it('returns null for a message with no UID at all', () => {
    expect(parseSelftestUid('BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nEND:VCALENDAR')).toBeNull();
  });

  it('is not fooled by a self-test UID into returning an event id', () => {
    // The other direction of the same rule, and the reason the self-test is
    // asked about FIRST in processRsvpReply: parseEventUid must not claim one.
    expect(parseEventUid(`UID:${selftestUid('00ff00ff00ff00ff')}`)).toBeNull();
  });

  it('still parses a real event UID, both formats', () => {
    expect(parseEventUid(`UID:${eventUid(7)}`)).toBe(7);
    expect(parseEventUid('UID:dinnerbears-event-7@dinnerbears.com')).toBe(7);
  });
});

/**
 * **The fold, which is what stage found** (2026-11-14).
 *
 * A self-test reply came back from a real mail client and was filed as
 * `unknown_uid`: the reply had arrived, the whole inbound leg worked, and the
 * UID simply did not match. The cause is a line length.
 *
 *     UID:communityevents-selftest-<32 hex>@communityeventsproject.com
 *
 * is 87 octets, and RFC 5545 §3.1 caps a CONTENT-LINE at 75 — so the client
 * folds it across two lines when it echoes it back, and a parser that has not
 * unfolded first sees two fragments of a UID and no UID.
 *
 * It had never bitten because the event UID is ~54 octets and never folds, and
 * `processRsvpReply` unfolded only *after* asking about the UID. Both parsers
 * now unfold for themselves, so neither depends on being handed tidy input.
 */
describe('UID parsing across an RFC 5545 fold', () => {
  const nonce = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('reads a self-test UID folded by the client', () => {
    const folded = `UID:communityevents-selftest-${nonce.slice(0, 20)}\r\n ${nonce.slice(20)}@communityeventsproject.com`;
    expect(parseSelftestUid(folded)).toBe(nonce);
  });

  it('reads one folded with a tab, which the spec also allows', () => {
    const folded = `UID:communityevents-selftest-${nonce.slice(0, 10)}\r\n\t${nonce.slice(10)}@communityeventsproject.com`;
    expect(parseSelftestUid(folded)).toBe(nonce);
  });

  it('reads a folded UID inside a whole reply body', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'METHOD:REPLY',
      'BEGIN:VEVENT',
      `UID:communityevents-selftest-${nonce.slice(0, 24)}`,
      ` ${nonce.slice(24)}@communityeventsproject.com`,
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:admin@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseSelftestUid(ical)).toBe(nonce);
  });

  it('reads an event UID folded too, though it is short enough not to be', () => {
    // Nothing emits this today. It is asserted because the event parser had the
    // same latent defect and the only reason it never showed was a line length.
    expect(parseEventUid('UID:communityevents-event-4\r\n 2@communityeventsproject.com')).toBe(42);
  });

  it('still refuses a UID broken across lines without a fold marker', () => {
    // A bare newline is a new CONTENT-LINE, not a continuation. Joining those
    // would invent a UID out of two unrelated properties.
    expect(
      parseSelftestUid(`UID:communityevents-selftest-${nonce.slice(0, 20)}\r\n${nonce.slice(20)}@communityeventsproject.com`),
    ).toBeNull();
  });
});
