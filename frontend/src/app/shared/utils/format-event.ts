/** Converts a "HH:MM" 24-hour time string to 12-hour "h:mm AM/PM" display format. */
export function formatEventTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Up to two uppercase initials from a display name, for avatar-chip fallbacks. */
export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
