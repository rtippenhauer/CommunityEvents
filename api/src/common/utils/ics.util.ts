/**
 * The iCalendar UID for an event (v2-10).
 *
 * A UID is a calendar entry's stable identity, not decoration: a client that
 * sees a known event arrive under a new UID treats the old entry as cancelled
 * and the new one as fresh. So this changed exactly once, when the old
 * `dinnerbears-event-N@dinnerbears.com` stopped being an acceptable thing for
 * every community's feed to emit, and it must not change again.
 *
 * The domain is the platform's and deliberately NOT the community's own host.
 * A UID must stay stable for the life of the entry, and a community can change
 * its domain -- which would silently re-identify every event it ever published.
 *
 * It lives here rather than in a service because three places emit a UID
 * (the subscription feed, the invitation, and the single-event download) and
 * one parses it back. Holding the format in one place is what keeps the
 * emitted value and the parser from drifting apart.
 */
export function eventUid(eventId: number): string {
  return `communityevents-event-${eventId}@communityeventsproject.com`;
}

/**
 * Undoes RFC 5545 line folding: a CRLF followed by one space or tab is a
 * continuation, not a new line.
 *
 * **Every parser below unfolds for itself, and that is the point** (v2-48,
 * found on stage). A reply to the mail-chain self-test came back from a real
 * mail client and was filed as `unknown_uid` -- the message had arrived and the
 * whole inbound leg had worked, and the UID simply did not match. The reason
 * was a line length: §3.1 caps a CONTENT-LINE at 75 octets, the self-test UID
 * is 87, so the client folded it when echoing it back, and the caller unfolded
 * only *after* asking about the UID.
 *
 * The event UID is ~54 octets and never folds, which is the only reason that
 * parser had never shown the same defect. A parser that is correct only when
 * somebody else tidied its input first is a trap for whoever writes the next
 * caller, so the unfolding belongs here rather than in the one place that
 * happened to remember it.
 */
export function unfoldIcs(ical: string): string {
  return ical.replace(/\r?\n[ \t]/g, '');
}

/**
 * Event id from an inbound reply's UID, accepting the pre-v2-10 format.
 *
 * Both are matched because the two live side by side indefinitely: a member
 * whose calendar still holds an event published under the old UID replies with
 * that UID, and dropping it would silently discard their RSVP. Written as two
 * full alternatives rather than a loose character class, so a combination this
 * code never emits is not quietly accepted. The legacy branch can only retire
 * once no client anywhere holds a pre-v2-10 entry, which is not something this
 * code can observe.
 */
export function parseEventUid(ical: string): number | null {
  const match = unfoldIcs(ical).match(
    /UID:(?:communityevents-event-(\d+)@communityeventsproject\.com|dinnerbears-event-(\d+)@dinnerbears\.com)/i,
  );
  if (!match) return null;
  // Exactly one branch matches, so exactly one group is defined.
  return parseInt(match[1] ?? match[2], 10);
}

/**
 * The UID for a mail-chain self-test invite (v2-48).
 *
 * **Its own namespace, carrying a nonce and never an event id.** The whole
 * point of the self-test is that it proves the chain without touching a
 * community's data, and a UID in the event namespace would be one slip away
 * from writing an `event_rsvps` row -- which is to say from a test appearing in
 * an attendee list or a headcount.
 *
 * The domain is the deployment's, exactly as `eventUid`'s is: `eventUid`
 * hardcodes `@communityeventsproject.com` for every tenant, so the UID
 * namespace belongs to the deployment regardless of whose community sent the
 * invite. The *tenant's* domain goes in the invite's title instead, which is
 * where seeing it is actually worth something -- a wrong sending host is then
 * visible in the subject line.
 */
export function selftestUid(nonce: string): string {
  return `communityevents-selftest-${nonce}@communityeventsproject.com`;
}

/**
 * The nonce from an inbound reply's UID, or null if this is not a self-test.
 *
 * **Must be asked before `parseEventUid`.** That function matches two literal
 * event shapes and returns null for anything else, and its caller turns null
 * into `UNKNOWN_UID` and discards the message -- so a self-test added as a
 * third alternative there would be silently thrown away. It is a separate
 * question asked first, not a third branch of the same regex.
 *
 * The nonce character class is deliberately narrow (hex, which is what
 * `randomBytes().toString('hex')` produces) rather than a loose `.+`: a
 * combination this code never emits must not be quietly accepted, which is the
 * same reasoning `parseEventUid` spells its two alternatives out in full.
 */
export function parseSelftestUid(ical: string): string | null {
  const match = unfoldIcs(ical).match(
    /UID:communityevents-selftest-([0-9a-f]{8,64})@communityeventsproject\.com/i,
  );
  return match ? match[1].toLowerCase() : null;
}

/** Assumed event length for calendar entries — no explicit end time is stored. */
export const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

// RFC 5545 §3.1: a CONTENT-LINE may be no longer than 75 octets; continuation
// lines (after the first fold) lose one octet to the leading space.
const RFC5545_LINE_LIMIT = 75;
const RFC5545_CONTINUATION_LIMIT = 74;
// UTF-8 continuation-byte mask: 10xxxxxx bytes (0x80-0xBF) must never be split from their lead byte.
const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_TAG = 0x80;

/** Escapes a value for use in an RFC 5545 TEXT property (SUMMARY, DESCRIPTION, LOCATION, etc). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Converts a stored "America/New_York" wall-clock date+time into a UTC Date,
 * accounting for DST — event times are stored as Eastern local time, but
 * RFC 5545 DTSTART/DTEND values must be UTC.
 */
export function eventTimeToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);

  const approx = new Date(Date.UTC(y, m - 1, d, h, min, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(approx);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const easternH = get('hour') % 24;
  const easternMin = get('minute');
  const diffMin = (h * 60 + min) - (easternH * 60 + easternMin);
  return new Date(approx.getTime() + diffMin * 60 * 1000);
}

/** Formats a Date as an RFC 5545 UTC DATE-TIME value (YYYYMMDDTHHMMSSZ). */
export function toIcsUtcString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Folds a CONTENT-LINE to RFC 5545's 75-octet limit, breaking only on UTF-8 character boundaries. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= RFC5545_LINE_LIMIT) return line;

  const parts: string[] = [];
  let pos = 0;
  let first = true;

  while (pos < bytes.length) {
    const limit = first ? RFC5545_LINE_LIMIT : RFC5545_CONTINUATION_LIMIT;
    let end = Math.min(pos + limit, bytes.length);
    while (end > pos && (bytes[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_TAG) end--;
    parts.push(bytes.subarray(pos, end).toString('utf-8'));
    pos = end;
    first = false;
  }

  return parts.join('\r\n ');
}

// SEQUENCE is an RFC 5545 INTEGER, which the spec caps at the signed 32-bit
// maximum. Counting from 2020 rather than from the Unix epoch is what buys the
// headroom: epoch seconds cross 2^31 in 2038, seconds since 2020 not until 2088.
const ICS_SEQUENCE_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * A SEQUENCE value that only ever increases.
 *
 * A calendar client ignores a METHOD:REQUEST whose SEQUENCE is not HIGHER than
 * the one it already holds for that UID, so this must never go backwards for
 * the life of an event. It used to be taken `% 999999`, which wrapped to zero
 * every 11.57 days — and after each wrap an invite for an event the member had
 * already seen carried a LOWER number and was discarded in silence, leaving
 * whatever their calendar held (a stale Declined, say) while the website showed
 * the new RSVP. Nothing bounces and nothing logs, so the only symptom is a
 * member saying their calendar is wrong.
 */
export function icsSequence(at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - ICS_SEQUENCE_EPOCH_MS) / 1000));
}
