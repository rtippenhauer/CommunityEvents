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
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let pos = 0;
  let first = true;

  while (pos < bytes.length) {
    const limit = first ? 75 : 74;
    let end = Math.min(pos + limit, bytes.length);
    while (end > pos && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(pos, end).toString('utf-8'));
    pos = end;
    first = false;
  }

  return parts.join('\r\n ');
}
