import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Prisma, users as User } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EventStatus, InboundEmailOutcome, RsvpStatus } from '../../database/enums';
import { asDateString, asTimeString } from '../../common/utils/prisma-date.util';
import { icsEscape, eventTimeToUtc, toIcsUtcString, foldIcsLine, EVENT_DURATION_MS, eventUid, parseEventUid } from '../../common/utils/ics.util';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';
import { AppConfigService } from '../app-config/app-config.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-store';
import type { TenantContext } from '../../common/tenant/tenant-context';
import { extractIcalFromEmail } from './ical-extract.util';

/**
 * What an inbound calendar reply turned out to mean (v2-34).
 *
 * `processRsvpReply` returns one of these instead of logging and returning
 * `void`, so its caller can write a single row to the inbound log. Everything
 * but `outcome` is best-effort: most failure outcomes stop before there is an
 * event or a member to name, and the screen is honest about that rather than
 * inventing values.
 *
 * `tenantId` is **the community the message turned out to belong to**, which is
 * not necessarily the host it arrived on — see `TENANT_MISMATCH`, where they
 * differ and that difference is the whole finding.
 */
export interface RsvpReplyOutcome {
  outcome: InboundEmailOutcome;
  detail?: string;
  tenantId?: number | null;
  eventId?: number | null;
  userId?: number | null;
  rsvpStatus?: string | null;
}

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
    const url = this.config.get<string>('APP_URL', 'https://communityeventsproject.com');
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
      `UID:${eventUid(event.id)}`,
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
      `UID:${eventUid(event.id)}`,
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

  /**
   * `requestTenant` is the community whose host the reply was POSTed to, which
   * is NOT necessarily the one the reply is about. The Cloudflare Worker posts
   * everything arriving at a calendar address to one API_URL, and a community on
   * a subdomain of this deployment shares the deployment's calendar address --
   * so a reply about any of those communities' events lands on the root host.
   * The community is therefore taken from the event the UID names (event ids are
   * unique across the database), and everything after that runs inside it. The
   * host only narrows: a reply POSTed to a non-root community's own host is
   * accepted only for that community's events.
   */
  /**
   * Work out what an inbound reply means, and say so.
   *
   * **Returns an outcome rather than logging one** (v2-34). Every exit below
   * used to be a `logger.warn` and a bare `return`, which made the failure mode
   * "a member pressed Accept and their RSVP did not change", with a container
   * log line as the only evidence. The caller records what comes back, so the
   * thirteen places this can stop all reach the log through one write — Rob's
   * call (2026-10-20) and the reason this signature is not `void`.
   *
   * The logger lines stay. They cost nothing and the log row is a database
   * write that can itself fail, which is exactly when you want the old
   * evidence.
   */
  async processRsvpReply(
    rawEmail: string,
    requestTenant?: TenantContext,
  ): Promise<RsvpReplyOutcome> {
    const ical = extractIcalFromEmail(rawEmail);
    if (!ical) {
      this.logger.warn('rsvp-reply: no iCal block found in email');
      return { outcome: InboundEmailOutcome.NO_ICAL };
    }

    if (!/METHOD:REPLY/i.test(ical)) {
      this.logger.debug('rsvp-reply: not a METHOD:REPLY, ignoring');
      return { outcome: InboundEmailOutcome.NOT_A_REPLY };
    }

    const eventId = parseEventUid(ical);
    if (eventId === null) {
      this.logger.warn('rsvp-reply: unrecognized UID format');
      return { outcome: InboundEmailOutcome.UNKNOWN_UID };
    }

    // Unfold RFC 5545 line continuations then parse ATTENDEE
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const attendeeLine = unfolded.match(/^ATTENDEE[^:\r\n]*:[^\r\n]+/im)?.[0] ?? '';
    const partstatMatch = attendeeLine.match(/PARTSTAT=([A-Z-]+)/i);
    const emailMatch = attendeeLine.match(/:mailto:([^\s;,\r\n]+)/i);

    if (!partstatMatch || !emailMatch) {
      this.logger.warn(`rsvp-reply: could not parse ATTENDEE line: ${attendeeLine || '(not found)'}`);
      this.logger.debug(`rsvp-reply: iCal snippet: ${ical.slice(0, 400)}`);
      return {
        outcome: InboundEmailOutcome.UNPARSEABLE_ATTENDEE,
        // The line itself, because this is the one failure where the fix
        // depends on what the sender actually wrote.
        detail: attendeeLine || '(no ATTENDEE line found)',
        eventId,
      };
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
      return {
        outcome: InboundEmailOutcome.UNHANDLED_PARTSTAT,
        detail: `PARTSTAT=${partstat}`,
        eventId,
      };
    }

    const event = await runUnscoped(
      'calendar reply: the UID names an event, and the event names its community',
      async () =>
        await this.prisma.events.findUnique({
          where: { id: eventId },
          select: { id: true, tenantId: true, status: true },
        }),
    );
    if (!event || event.status !== EventStatus.PUBLISHED) {
      this.logger.warn(`rsvp-reply: event ${eventId} not found or not published`);
      return {
        outcome: InboundEmailOutcome.EVENT_NOT_FOUND,
        detail: event ? `event ${eventId} is ${event.status}, not published` : undefined,
        eventId,
      };
    }
    if (requestTenant && !requestTenant.isRoot && requestTenant.id !== event.tenantId) {
      this.logger.warn(
        `rsvp-reply: event ${eventId} belongs to tenant ${event.tenantId}, but the reply was posted to tenant ${requestTenant.id}'s host`,
      );
      // **The multi-tenant fault.** Recorded against the tenant that OWNS the
      // event, not the host the reply landed on: the question an operator is
      // answering is "whose reply went astray", and the event's community is
      // the one missing an RSVP. The host is in the detail so both ends of the
      // mismatch are on the row.
      return {
        outcome: InboundEmailOutcome.TENANT_MISMATCH,
        detail: `event belongs to tenant ${event.tenantId}, reply arrived on tenant ${requestTenant.id}'s host`,
        tenantId: event.tenantId,
        eventId,
      };
    }

    return runWithTenant(event.tenantId, async () =>
      this.recordRsvpReply(eventId, attendeeEmail, rsvpStatus, event.tenantId),
    );
  }

  /** The write half of a reply, run inside the event's own community. */
  private async recordRsvpReply(
    eventId: number,
    attendeeEmail: string,
    rsvpStatus: RsvpStatus,
    tenantId: number,
  ): Promise<RsvpReplyOutcome> {
    // findFirst: the address is only unique within a tenant. The extension
    // supplies the tenant, which processRsvpReply has just set to the event's
    // own -- so this finds the member the invitation was sent to, not a
    // same-address account in whichever community the reply was posted to.
    const user = await this.prisma.users.findFirst({ where: { email: attendeeEmail } });
    if (!user) {
      this.logger.warn(`rsvp-reply: no user found for ${attendeeEmail}`);
      return {
        outcome: InboundEmailOutcome.MEMBER_NOT_FOUND,
        detail: `no member of this community holds ${attendeeEmail}`,
        tenantId,
        eventId,
        rsvpStatus,
      };
    }

    const existing = await this.prisma.event_rsvps.findFirst({
      where: { eventId, userId: user.id },
    });
    if (existing) {
      // Understood, and it already said this. Reported as its own outcome
      // rather than as `recorded`: "we changed nothing" answers a different
      // question than "it worked", and a member asking why their reply did
      // nothing deserves the honest one.
      if (existing.status === rsvpStatus) {
        return {
          outcome: InboundEmailOutcome.UNCHANGED,
          tenantId,
          eventId,
          userId: user.id,
          rsvpStatus,
        };
      }
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
    return {
      outcome: InboundEmailOutcome.RECORDED,
      tenantId,
      eventId,
      userId: user.id,
      rsvpStatus,
    };
  }
}
