/**
 * RSVP for an event closes 150 minutes (2.5 hours) before its start time,
 * Eastern time — the point at which the reservation coordinator finalizes
 * the headcount with the restaurant. Shared by RSVP enforcement and event
 * invite-link expiration so both agree on the exact same cutoff instant.
 */
const RSVP_CUTOFF_MINUTES_BEFORE = 150;

function easternWallClockToUtc(dateStr: string, hour: number, minute: number): Date {
  const pad = (n: number): string => String(n).padStart(2, '0');
  // Treat the wall-clock time as if it were UTC, then measure how far off that
  // guess is once viewed through the America/New_York timezone (which varies
  // with DST), and shift by that offset to land on the real UTC instant.
  const naiveUtc = new Date(`${dateStr}T${pad(hour)}:${pad(minute)}:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(naiveUtc);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const asIfUtc = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`);
  const offsetMs = naiveUtc.getTime() - asIfUtc.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

export function computeRsvpCutoffAt(eventDate: string, eventTime: string): Date {
  const [h, min] = eventTime.split(':').map(Number);
  let cutoffMinutes = h * 60 + min - RSVP_CUTOFF_MINUTES_BEFORE;
  let cutoffDate = eventDate;

  if (cutoffMinutes < 0) {
    cutoffMinutes += 24 * 60;
    const d = new Date(`${eventDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cutoffDate = d.toISOString().slice(0, 10);
  }

  const cutoffHour = Math.floor(cutoffMinutes / 60);
  const cutoffMin = cutoffMinutes % 60;
  return easternWallClockToUtc(cutoffDate, cutoffHour, cutoffMin);
}

export function isPastRsvpCutoff(eventDate: string, eventTime: string, now: Date = new Date()): boolean {
  return now >= computeRsvpCutoffAt(eventDate, eventTime);
}
