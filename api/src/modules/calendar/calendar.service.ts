import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Prisma, users as User } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EventStatus, RsvpStatus } from '../../database/enums';
import { asDateString, asTimeString } from '../../common/utils/prisma-date.util';
import { icsEscape, eventTimeToUtc, toIcsUtcString, foldIcsLine, EVENT_DURATION_MS } from '../../common/utils/ics.util';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';
import { AppConfigService } from '../app-config/app-config.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';

/**
 * The minimum an event needs to expose to be rendered into an .ics entry.
 *
 * Deliberately structural rather than a Prisma or TypeORM type: calendar is
 * fed both by its own Prisma queries and by EventsService, which is still on
 * TypeORM until v2-2. Those disagree on eventDate/eventTime -- Date versus
 * string -- so the union is what lets one implementation serve both. It
 * narrows to Date once the last caller is converted.
 */
export interface IcsEventLike {
  id: number;
  title: string;
  eventDate: Date | string;
  eventTime: Date | string;
  updatedAt: Date;
  status: string;
  // Both are NOT NULL in the schema; an event always carries its location
  // snapshot even when the linked location row is gone.
  locationName: string;
  locationAddress: string;
  location?: { id: number; isPrivate: boolean } | null;
}

export interface CalendarSettingsResponse {
  url: string;
  cityFilter: 'all' | 'city';
  rsvpOnly: boolean;
  autoInvite: 'none' | 'city' | 'all';
  cityName: string;
}

interface CacheEntry {
  ics: string;
  expiresAt: number;
}

/**
 * The two per-community addresses an .ics carries: the reply-to shown to
 * members, and the ORGANIZER the calendar client displays. Grouped because they
 * are always resolved and passed together.
 */
interface FeedContacts {
  support: string;
  organizer: string;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly userTokenMap = new Map<number, string>();
  private readonly TTL_MS = 15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly locationVisibility: LocationVisibilityService,
    private readonly appConfig: AppConfigService,
    private readonly tenantResolution: TenantResolutionService,
  ) {}

  // Per-instance branding for generated calendar files (Phase 32/33). Same
  // configurable rows the UI/emails read, so a fork's .ics carries its own
  // name and event term instead of hardcoded "DinnerBears"/"Dinner".
  private async getBrand(): Promise<{ brandName: string; eventSingular: string; eventPlural: string }> {
    const [brandName, eventSingular, eventPlural] = await Promise.all([
      this.appConfig.getSiteSetting('brand_name'),
      this.appConfig.getSiteSetting('term_dinner_singular'),
      this.appConfig.getSiteSetting('term_dinner_plural'),
    ]);
    return { brandName, eventSingular, eventPlural };
  }

  // ── Token management ────────────────────────────────────────────────────────

  async getOrCreateToken(userId: number): Promise<string> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.calendarToken) return user.calendarToken;

    const token = randomUUID();
    await this.prisma.users.update({ where: { id: userId }, data: { calendarToken: token } });
    this.userTokenMap.set(userId, token);
    return token;
  }

  async regenerateToken(userId: number): Promise<string> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.calendarToken) {
      this.cache.delete(user.calendarToken);
      this.userTokenMap.delete(userId);
    }

    const token = randomUUID();
    await this.prisma.users.update({ where: { id: userId }, data: { calendarToken: token } });
    this.userTokenMap.set(userId, token);
    return token;
  }

  // Async now: the host is the tenant's, not APP_URL's. A feed subscribed on one
  // community's host must keep pointing there -- the token behind it resolves
  // against `users`, which is scoped.
  async feedUrl(token: string): Promise<string> {
    const appUrl = await this.tenantResolution.baseUrlFor();
    return `${appUrl}/api/v1/calendar/feed.ics?token=${token}`;
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async getSettings(userId: number): Promise<CalendarSettingsResponse> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { city: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const token = await this.getOrCreateToken(userId);
    return {
      url: await this.feedUrl(token),
      cityFilter: user.calendarCityFilter ?? 'all',
      rsvpOnly: user.calendarRsvpOnly ?? false,
      autoInvite: user.calendarAutoInvite ?? 'none',
      cityName: user.city?.name ?? 'My city',
    };
  }

  async updateSettings(
    userId: number,
    dto: { cityFilter?: 'all' | 'city'; rsvpOnly?: boolean; autoInvite?: 'none' | 'city' | 'all' },
  ): Promise<CalendarSettingsResponse> {
    const updates: Prisma.usersUpdateInput = {};
    if (dto.cityFilter !== undefined) updates.calendarCityFilter = dto.cityFilter;
    if (dto.rsvpOnly !== undefined) updates.calendarRsvpOnly = dto.rsvpOnly;
    if (dto.autoInvite !== undefined) updates.calendarAutoInvite = dto.autoInvite;

    if (Object.keys(updates).length > 0) {
      await this.prisma.users.update({ where: { id: userId }, data: updates });
      this.invalidateForUser(userId);
    }

    return this.getSettings(userId);
  }

  // ── Feed generation ──────────────────────────────────────────────────────────

  async getFeed(token: string): Promise<string> {
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.ics;

    const user = await this.prisma.users.findUnique({ where: { calendarToken: token } });
    if (!user) throw new UnauthorizedException('Invalid calendar token');

    const ics = await this.buildFeed(user);
    this.cache.set(token, { ics, expiresAt: Date.now() + this.TTL_MS });
    this.userTokenMap.set(user.id, token);
    return ics;
  }

  // Stays on APP_URL deliberately: this asks "is this deployment stage", which
  // is a property of the deployment and not of any tenant. It builds no link.
  private appName(brandName: string): string {
    const url = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    return url.includes('stage') ? `${brandName} - Stage` : brandName;
  }

  // Resolved once per feed and threaded through, rather than looked up inside
  // buildVEvent: that runs once per event in a .map(), so a read there would be
  // N app_config queries for one feed, and would make the builder async for no
  // reason other than configuration.
  private async contactsFor(tenantId?: number): Promise<FeedContacts> {
    const [support, organizer] = await Promise.all([
      this.appConfig.supportEmail(tenantId),
      this.appConfig.calendarOrganizerEmail(tenantId),
    ]);
    return { support, organizer };
  }

  private async buildFeed(user: User): Promise<string> {
    // The subscriber's own tenant: a feed is fetched by token with no session,
    // so there may be no ambient context to inherit.
    const appUrl = await this.tenantResolution.baseUrlFor(user.tenantId);
    const brand = await this.getBrand();

    const rsvps = await this.prisma.event_rsvps.findMany({
      where: { userId: user.id },
      select: { eventId: true, status: true },
    });
    const rsvpMap = new Map(rsvps.map((r) => [r.eventId, r.status]));

    const today = new Date().toISOString().split('T')[0];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    const cityFilter = user.calendarCityFilter ?? 'all';
    const rsvpOnly = user.calendarRsvpOnly ?? false;

    // Published events from today on, plus cancelled ones for a week after --
    // a cancelled event has to keep appearing briefly so subscribed calendars
    // receive the cancellation rather than silently dropping the entry.
    // The date bounds are strings; Prisma compares DATE columns against Dates,
    // so they are parsed back to midnight UTC to match how the column is read.
    let events = await this.prisma.events.findMany({
      where: {
        OR: [
          { status: EventStatus.PUBLISHED, eventDate: { gte: new Date(`${today}T00:00:00Z`) } },
          { status: EventStatus.CANCELLED, eventDate: { gte: new Date(`${cutoffDate}T00:00:00Z`) } },
        ],
        ...(cityFilter === 'city' ? { cityId: user.cityId } : {}),
      },
      include: { location: true },
      orderBy: [{ eventDate: 'asc' }, { eventTime: 'asc' }],
    });

    if (rsvpOnly) {
      events = events.filter((e) => rsvpMap.has(e.id));
    }

    if (events.length === 0) return this.emptyFeed(brand);

    // The subscriber's own tenant again, for the same reason appUrl uses it:
    // a feed is fetched by token, so there is no session to inherit from.
    const contacts = await this.contactsFor(user.tenantId);
    const vevents = events.map((e) =>
      this.buildVEvent(e, rsvpMap.get(e.id) ?? null, appUrl, brand, contacts),
    );

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${brand.brandName}//${brand.brandName} Calendar//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      foldIcsLine(`X-WR-CALNAME:${this.appName(brand.brandName)} — ${user.fullName}`),
      `X-WR-CALDESC:Your upcoming ${brand.brandName} ${brand.eventPlural.toLowerCase()}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
      'X-WR-TIMEZONE:America/New_York',
      ...vevents.flat(),
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  private buildVEvent(
    event: IcsEventLike,
    rsvpStatus: string | null,
    appUrl: string,
    brand: { brandName: string; eventSingular: string; eventPlural: string },
    contacts: FeedContacts,
  ): string[] {
    const { brandName, eventSingular } = brand;

    const startUtc = eventTimeToUtc(asDateString(event.eventDate), asTimeString(event.eventTime));
    const endUtc = new Date(startUtc.getTime() + EVENT_DURATION_MS);
    const dtStart = toIcsUtcString(startUtc);
    const dtEnd = toIcsUtcString(endUtc);
    const lastMod = toIcsUtcString(new Date(event.updatedAt));
    const dtStamp = toIcsUtcString(new Date());
    const sequence = Math.floor(new Date(event.updatedAt).getTime() / 60000) % 999999;

    const isCancelled = event.status === EventStatus.CANCELLED;

    // eventDate/eventTime are DATE/TIME columns. The entity typed them as
    // strings; Prisma returns Dates. Calling .split on a Date throws, so both
    // are normalised to their string form first.
    const [y, m, d] = asDateString(event.eventDate).split('-').map(Number);
    const [h, min] = asTimeString(event.eventTime).split(':').map(Number);
    const dayName = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long' });
    const hour12 = h % 12 || 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${hour12}:${String(min).padStart(2, '0')} ${ampm} ET`;

    const rsvpLine = rsvpStatus
      ? `🤝 Your RSVP: ${{ going: 'GOING', maybe: 'MAYBE', not_going: 'NOT GOING' }[rsvpStatus] ?? rsvpStatus.toUpperCase()}`
      : `👉 RSVP now: ${appUrl}/events/${event.id}`;

    const addressVisible = this.locationVisibility.canViewAddressSync(
      event.location ?? { id: -1, isPrivate: false },
      false,
      rsvpStatus === RsvpStatus.GOING,
    );
    const locationAddress = addressVisible ? event.locationAddress : null;

    const description = [
      `${brandName} ${eventSingular}`,
      '',
      `🍽 ${event.locationName}`,
      locationAddress || '',
      '',
      `📅 ${dayName}, ${monthName} ${d} at ${timeStr}`,
      '',
      rsvpLine,
      '',
      `View details: ${appUrl}/events/${event.id}`,
      '',
      '---',
      `Questions? Reply to ${contacts.support}`,
      `To manage your calendar subscription, visit your ${brandName} account settings.`,
    ].filter(Boolean).join('\n');

    const location = locationAddress
      ? `${event.locationName}, ${locationAddress}`
      : event.locationName;

    const lines = [
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      foldIcsLine(`SUMMARY:${icsEscape(isCancelled ? `[CANCELLED] ${event.locationName}` : `${brandName} ${eventSingular} at ${event.locationName}`)}`),
      foldIcsLine(`LOCATION:${icsEscape(location)}`),
      foldIcsLine(`DESCRIPTION:${icsEscape(description)}`),
      foldIcsLine(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=${brandName}:mailto:${contacts.organizer}`,
      `STATUS:${isCancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ];

    return lines;
  }

  private emptyFeed(brand: { brandName: string; eventPlural: string }): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${brand.brandName}//${brand.brandName} Calendar//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${this.appName(brand.brandName)}`,
      `X-WR-CALDESC:Your upcoming ${brand.brandName} ${brand.eventPlural.toLowerCase()}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  // ── Cache invalidation ────────────────────────────────────────────────────────

  invalidateForUser(userId: number): void {
    const token = this.userTokenMap.get(userId);
    if (token) this.cache.delete(token);
  }

  async invalidateAll(): Promise<void> {
    const users = await this.prisma.users.findMany({
      where: { calendarToken: { not: null } },
      select: { id: true },
    });
    for (const u of users) this.invalidateForUser(u.id);
  }

  // ── iCal helpers ─────────────────────────────────────────────────────────────

  // ── Email attachment (.ics for Phase 16b) ────────────────────────────────────

  // locationAddress override — see buildGoogleCalendarUrl's note in events.service.ts.
  async buildInviteAttachment(
    event: IcsEventLike,
    recipient: { name: string; email: string },
    appUrl: string,
    locationAddress: string | null = event.locationAddress,
  ): Promise<string> {
    const { brandName, eventSingular } = await this.getBrand();
    // Ambient tenant here, unlike buildFeed: every caller reaches this from a
    // request or from a sweep that has already re-entered runWithTenant, and
    // resolves the appUrl it passes in the same way.
    const contacts = await this.contactsFor();
    const startUtc = eventTimeToUtc(asDateString(event.eventDate), asTimeString(event.eventTime));
    const endUtc = new Date(startUtc.getTime() + EVENT_DURATION_MS);
    const dtStart = toIcsUtcString(startUtc);
    const dtEnd = toIcsUtcString(endUtc);
    const now = new Date();
    const lastMod = toIcsUtcString(new Date(event.updatedAt));
    const dtStamp = toIcsUtcString(now);
    // Must reflect when THIS invite was sent, not when the event was last edited —
    // re-confirming the same RSVP (toggling away and back to Going) re-sends this
    // same UID with the event's unchanged updatedAt, so a SEQUENCE derived from
    // that never advances between sends. Without an incrementing SEQUENCE (and
    // with DTSTAMP previously missing entirely), calendar clients have no signal
    // that a later email supersedes an earlier one and can create a duplicate
    // pending invitation per message instead of updating the same one in place.
    const sequence = Math.floor(now.getTime() / 1000) % 999999;

    // eventDate/eventTime are DATE/TIME columns. The entity typed them as
    // strings; Prisma returns Dates. Calling .split on a Date throws, so both
    // are normalised to their string form first.
    const [y, m, d] = asDateString(event.eventDate).split('-').map(Number);
    const [h, min] = asTimeString(event.eventTime).split(':').map(Number);
    const dayName = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long' });
    const hour12 = h % 12 || 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${hour12}:${String(min).padStart(2, '0')} ${ampm} ET`;

    const description = [
      `${brandName} ${eventSingular}`,
      '',
      `🍽 ${event.locationName}`,
      locationAddress || '',
      '',
      `📅 ${dayName}, ${monthName} ${d} at ${timeStr}`,
      '',
      `View details and RSVP: ${appUrl}/events/${event.id}`,
      '',
      '---',
      `Questions? Reply to ${contacts.support}`,
    ].join('\n');

    const location = locationAddress
      ? `${event.locationName}, ${locationAddress}`
      : event.locationName;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${brandName}//${brandName} Calendar//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      foldIcsLine(`SUMMARY:${icsEscape(`${brandName} ${eventSingular} at ${event.locationName}`)}`),
      foldIcsLine(`LOCATION:${icsEscape(location)}`),
      foldIcsLine(`DESCRIPTION:${icsEscape(description)}`),
      foldIcsLine(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=${brandName}:mailto:${contacts.organizer}`,
      foldIcsLine(`ATTENDEE;CN=${icsEscape(recipient.name)};RSVP=TRUE:mailto:${recipient.email}`),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  // ── Inbound reply processing (Phase 16c) ─────────────────────────────────────

  async processRsvpReply(rawEmail: string): Promise<void> {
    const ical = this.extractIcalFromEmail(rawEmail);
    if (!ical) {
      this.logger.warn('rsvp-reply: no iCal block found in email');
      return;
    }

    if (!/METHOD:REPLY/i.test(ical)) {
      this.logger.debug('rsvp-reply: not a METHOD:REPLY, ignoring');
      return;
    }

    const uidMatch = ical.match(/UID:dinnerbears-event-(\d+)@dinnerbears\.com/i);
    if (!uidMatch) {
      this.logger.warn('rsvp-reply: unrecognized UID format');
      return;
    }
    const eventId = parseInt(uidMatch[1], 10);

    // Unfold RFC 5545 line continuations then parse ATTENDEE
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const attendeeLine = unfolded.match(/^ATTENDEE[^:\r\n]*:[^\r\n]+/im)?.[0] ?? '';
    const partstatMatch = attendeeLine.match(/PARTSTAT=([A-Z-]+)/i);
    const emailMatch = attendeeLine.match(/:mailto:([^\s;,\r\n]+)/i);

    if (!partstatMatch || !emailMatch) {
      this.logger.warn(`rsvp-reply: could not parse ATTENDEE line: ${attendeeLine || '(not found)'}`);
      this.logger.debug(`rsvp-reply: iCal snippet: ${ical.slice(0, 400)}`);
      return;
    }

    const partstat = partstatMatch[1].toUpperCase();
    const attendeeEmail = emailMatch[1].trim().toLowerCase();

    const statusMap: Record<string, RsvpStatus> = {
      ACCEPTED: RsvpStatus.GOING,
      TENTATIVE: RsvpStatus.MAYBE,
      DECLINED: RsvpStatus.NOT_GOING,
    };
    const rsvpStatus = statusMap[partstat];
    if (!rsvpStatus) {
      this.logger.debug(`rsvp-reply: unhandled PARTSTAT=${partstat}, ignoring`);
      return;
    }

    const event = await this.prisma.events.findUnique({ where: { id: eventId } });
    if (!event || event.status !== EventStatus.PUBLISHED) {
      this.logger.warn(`rsvp-reply: event ${eventId} not found or not published`);
      return;
    }

    // findFirst: the address is only unique within a tenant now. No tenant is
    // named here because the extension supplies it -- and it is the right one,
    // since the events lookup just above resolved in the same context.
    const user = await this.prisma.users.findFirst({ where: { email: attendeeEmail } });
    if (!user) {
      this.logger.warn(`rsvp-reply: no user found for ${attendeeEmail}`);
      return;
    }

    const existing = await this.prisma.event_rsvps.findFirst({
      where: { eventId, userId: user.id },
    });
    if (existing) {
      if (existing.status === rsvpStatus) return;
      await this.prisma.event_rsvps.update({
        where: { id: existing.id },
        data: { status: rsvpStatus },
      });
    } else {
      await this.prisma.event_rsvps.create({
        data: { eventId, userId: user.id, status: rsvpStatus, additionalGuests: 0 },
      });
    }

    this.invalidateForUser(user.id);
    this.logger.log(`rsvp-reply: ${attendeeEmail} → ${rsvpStatus} for event ${eventId}`);
  }

  private extractIcalFromEmail(rawEmail: string): string | null {
    // Try plain-text first — BEGIN:VCALENDAR is readable ASCII, so if this matches
    // directly the block was never actually quoted-printable encoded (real QP
    // encoding would have broken up "BEGIN:VCALENDAR" itself with soft line
    // breaks, in which case this regex wouldn't match at all — see the fallback
    // branch below for that case). Only undo QP soft-line-break folding here —
    // do NOT run full hex-escape decoding (`=3D` etc.) on already-clean text: its
    // "=XY" pattern also matches plenty of legitimate iCal content whenever X and
    // Y happen to be hex digits (e.g. "PARTSTAT=ACCEPTED" contains "=AC", and
    // "PARTSTAT=DECLINED" contains "=DE"), silently corrupting real PARTSTAT
    // values while "=TE" in "TENTATIVE" happens to survive since T isn't hex.
    const inline = rawEmail.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
    if (inline) return inline[0].replace(/=\r?\n/g, '');

    // Try after full QP decode of the email (catches cases where the iCal section
    // has soft-line-break folding that obscures the BEGIN: marker)
    const qpDecoded = this.decodeQuotedPrintable(rawEmail);
    const qpMatch = qpDecoded.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
    if (qpMatch) return qpMatch[0];

    // Base64-encoded MIME part
    const b64Parts = rawEmail.match(/Content-Transfer-Encoding:\s*base64[\s\S]*?(?=\n--|\n\n--|$)/gi) ?? [];
    for (const part of b64Parts) {
      const b64 = part.match(/\n\n([\w+/=\r\n]+)/)?.[1];
      if (!b64) continue;
      try {
        const decoded = Buffer.from(b64.replace(/[\r\n]/g, ''), 'base64').toString('utf-8');
        const cal = decoded.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
        if (cal) return cal[0];
      } catch {
        // ignore malformed base64
      }
    }

    return null;
  }

  private decodeQuotedPrintable(str: string): string {
    return str
      .replace(/=\r?\n/g, '')  // remove QP soft line breaks
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}
