import { ConfigService } from '@nestjs/config';

// White-label helpers: derive an instance's public contact addresses from its
// own domain instead of hardcoding dinnerbears.com. A fork only needs to set
// APP_URL (or BASE_DOMAIN) and its calendar/support emails follow automatically
// — each can still be overridden explicitly with its own env var.

// The instance's bare domain, e.g. "dinnerbears.com" or "sons.example.com".
// Prefers an explicit BASE_DOMAIN (also used for the auth cookie scope), then
// falls back to APP_URL's host with any leading "www." stripped.
export function baseDomain(config: ConfigService): string {
  const explicit = config.get<string>('BASE_DOMAIN');
  if (explicit) return explicit.trim();
  const appUrl = config.get<string>('APP_URL', 'https://dinnerbears.com');
  try {
    return new URL(appUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'dinnerbears.com';
  }
}

// Reply-to address surfaced to members (e.g. in calendar-feed descriptions).
// SUPPORT_EMAIL overrides; otherwise hello@<domain>.
export function supportEmail(config: ConfigService): string {
  return config.get<string>('SUPPORT_EMAIL') || `hello@${baseDomain(config)}`;
}

// "From"/organizer address on generated calendar feeds. CALENDAR_ORGANIZER_EMAIL
// overrides; otherwise calendar@<domain> (calendar-stage@ on the stage host).
export function calendarOrganizerEmail(config: ConfigService): string {
  const override = config.get<string>('CALENDAR_ORGANIZER_EMAIL');
  if (override) return override;
  const appUrl = config.get<string>('APP_URL', 'https://dinnerbears.com');
  const prefix = appUrl.includes('stage') ? 'calendar-stage' : 'calendar';
  return `${prefix}@${baseDomain(config)}`;
}

// ORGANIZER address on per-event .ics attachments. EVENT_ORGANIZER_EMAIL
// overrides; otherwise noreply@<domain>.
export function eventOrganizerEmail(config: ConfigService): string {
  return config.get<string>('EVENT_ORGANIZER_EMAIL') || `noreply@${baseDomain(config)}`;
}
