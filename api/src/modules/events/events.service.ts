import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  events as EventRow,
  event_guest_links as EventGuestLink,
  event_rsvps as EventRsvp,
  users as User,
} from '@prisma/client';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  EventStatus,
  InviteFlavor,
  InviteType,
  RsvpStatus,
  UserRole,
  UserStatus,
} from '../../database/enums';
import {
  toDateColumn,
  toDateString,
  toTimeColumn,
  toTimeString,
} from '../../common/utils/prisma-date.util';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { SetReservationDto } from './dto/set-reservation.dto';
import { EmailService } from '../email/email.service';
import { CalendarService } from '../calendar/calendar.service';
import { PointsService, SecretDinnerResync } from '../community/points.service';
import { AchievementsService } from '../community/achievements.service';
import { ConfigService } from '@nestjs/config';
import { isPastRsvpCutoff } from '../../common/utils/rsvp-cutoff.util';
import { toPublicUser } from '../../common/utils/public-user.util';
import { icsEscape, eventTimeToUtc, toIcsUtcString, foldIcsLine, EVENT_DURATION_MS } from '../../common/utils/ics.util';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';
import { eventOrganizerEmail } from '../../common/config/instance-contact';

/** An event with its location (and that location's photos) loaded. */
type EventWithLocation = Prisma.eventsGetPayload<{
  include: { location: { include: { photos: true } } };
}>;

/** The fully-loaded shape findOne returns. */
type EventDetailRow = Prisma.eventsGetPayload<{
  include: {
    city: true;
    location: { include: { photos: true } };
    createdByUser: true;
    rsvps: { include: { user: true; guestLinks: true } };
    reservationAssignee: true;
  };
}>;

/** The shape findAll returns, before the computed counts are attached. */
type EventListRow = Prisma.eventsGetPayload<{
  include: {
    city: true;
    location: { include: { photos: true } };
    createdByUser: true;
    reservationAssignee: true;
  };
}>;
import { AppConfigService } from '../app-config/app-config.service';
import { coerceRawRows } from '../../common/utils/prisma-raw.util';

export interface EventFilters {
  cityId?: number;
  upcoming?: boolean;
  fromDate?: string;
  status?: EventStatus;
  isAdminOrMod?: boolean;
  userId?: number;
  callerRole?: UserRole;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
    private readonly pointsService: PointsService,
    private readonly achievementsService: AchievementsService,
    private readonly config: ConfigService,
    private readonly locationVisibility: LocationVisibilityService,
    private readonly appConfig: AppConfigService,
  ) {}

  // Per-instance branding for transactional emails / calendar files. Reads the
  // same configurable rows the UI uses (Phase 32) so a fork's emails carry its
  // own name/tagline/event term instead of hardcoded "DinnerBears". The event
  // term (`term_dinner_*`) is title-case in config (DinnerBears pins "Dinner");
  // lowercase variants are provided for mid-sentence use.
  private async getEmailBrand(): Promise<{
    brandName: string;
    tagline: string;
    eventSingular: string;
    eventPlural: string;
    eventSingularLower: string;
    eventPluralLower: string;
    logoUrl: string;
  }> {
    const [brandName, tagline, eventSingular, eventPlural, brandLogoUrl] = await Promise.all([
      this.appConfig.getSiteSetting('brand_name'),
      this.appConfig.getSiteSetting('brand_tagline'),
      this.appConfig.getSiteSetting('term_dinner_singular'),
      this.appConfig.getSiteSetting('term_dinner_plural'),
      this.appConfig.getSiteSetting('brand_logo_url'),
    ]);
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    // brand_logo_url is already an absolute path (/api/uploads/branding/<file>)
    // once an admin uploads one; empty means no override, so fall back to the
    // same compiled-in default asset the frontend's BrandConfigService.logoSrc
    // falls back to when nothing's been uploaded.
    const logoUrl = `${appUrl}${brandLogoUrl || '/assets/logo.png'}`;
    return {
      brandName,
      tagline,
      eventSingular,
      eventPlural,
      eventSingularLower: eventSingular.toLowerCase(),
      eventPluralLower: eventPlural.toLowerCase(),
      logoUrl,
    };
  }

  async findAll(filters: EventFilters): Promise<(EventRow & { goingCount: number; totalAttending: number; attendeeSnippet: { fullName: string; profilePhotoPath: string | null }[]; myRsvpStatus: string | null })[]> {
    const where: Prisma.eventsWhereInput = {};
    if (filters.cityId) where.cityId = filters.cityId;
    if (filters.status) {
      where.status = filters.status;
    } else if (!filters.isAdminOrMod) {
      where.status = { not: EventStatus.DRAFT };
    }

    // Date bounds are 'YYYY-MM-DD' strings; the column is a DATE that Prisma
    // compares against Dates, so they are parsed to midnight UTC to match how
    // the value is read back.
    let orderBy: Prisma.eventsOrderByWithRelationInput[];
    if (filters.fromDate) {
      where.eventDate = { gte: toDateColumn(filters.fromDate) };
      orderBy = [{ eventDate: 'asc' }, { eventTime: 'asc' }];
    } else {
      const todayParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => todayParts.find((p) => p.type === t)?.value ?? '0';
      const today = `${get('year')}-${get('month')}-${get('day')}`;
      if (filters.upcoming === true) {
        where.eventDate = { gte: toDateColumn(today) };
        orderBy = [{ eventDate: 'asc' }, { eventTime: 'asc' }];
      } else if (filters.upcoming === false) {
        where.eventDate = { lt: toDateColumn(today) };
        orderBy = [{ eventDate: 'desc' }, { eventTime: 'desc' }];
      } else {
        orderBy = [{ eventDate: 'desc' }, { eventTime: 'desc' }];
      }
    }

    const events = await this.prisma.events.findMany({
      where,
      orderBy,
      include: {
        city: true,
        // Photos ordered explicitly: every caller treats photos[0] as "the
        // cover photo", and an unordered join makes the same location show a
        // different card image on different pages.
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
        createdByUser: true,
        reservationAssignee: true,
      },
    });
    if (events.length === 0) {
      return events as (EventListRow & { goingCount: number; totalAttending: number; attendeeSnippet: { fullName: string; profilePhotoPath: string | null }[]; myRsvpStatus: string | null })[];
    }

    const ids = events.map((e) => e.id);

    // One query: all going+maybe RSVPs with user names for counts and avatar snippet
    // status ascending puts 'going' before 'maybe' -- the enum's declaration
    // order, which is what the attendee snippet relies on.
    const rsvpRowsRaw = await this.prisma.event_rsvps.findMany({
      where: { eventId: { in: ids }, status: { in: [RsvpStatus.GOING, RsvpStatus.MAYBE] } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      select: {
        eventId: true,
        status: true,
        additionalGuests: true,
        user: { select: { fullName: true, profilePhotoPath: true } },
      },
    });
    const rsvpRows = rsvpRowsRaw.map((r) => ({
      eventId: r.eventId,
      status: r.status,
      additionalGuests: r.additionalGuests,
      fullName: r.user?.fullName ?? '',
      profilePhotoPath: r.user?.profilePhotoPath ?? null,
    }));

    const goingCountMap = new Map<number, number>();
    const totalMap = new Map<number, number>();
    const snippetMap = new Map<number, { fullName: string; profilePhotoPath: string | null }[]>();

    for (const row of rsvpRows) {
      const eid = Number(row.eventId);
      const guests = Number(row.additionalGuests) || 0;
      const seats = row.status === RsvpStatus.GOING ? 1 + guests : 1;

      if (row.status === RsvpStatus.GOING) {
        goingCountMap.set(eid, (goingCountMap.get(eid) ?? 0) + seats);
      }
      totalMap.set(eid, (totalMap.get(eid) ?? 0) + seats);

      const snippet = snippetMap.get(eid) ?? [];
      if (snippet.length < 3) {
        snippet.push({ fullName: row.fullName, profilePhotoPath: row.profilePhotoPath });
        snippetMap.set(eid, snippet);
      }
    }

    // Current user's RSVP status per event
    let myRsvpMap = new Map<number, string>();
    if (filters.userId) {
      const myRows = await this.prisma.event_rsvps.findMany({
        where: { eventId: { in: ids }, userId: filters.userId },
        select: { eventId: true, status: true },
      });
      myRsvpMap = new Map(myRows.map((r) => [Number(r.eventId), r.status]));
    }

    const isValidatedMember =
      filters.callerRole != null &&
      filters.callerRole !== UserRole.NON_VALIDATED;
    const isPrivileged = filters.callerRole === UserRole.ADMIN || filters.callerRole === UserRole.MODERATOR;

    return events.map((e) => {
      (e as any).createdByUser = toPublicUser(e.createdByUser);
      delete (e as any).reservationConfirmToken;
      if (!isValidatedMember) {
        (e as any).reservationAssignee = null;
        (e as any).reservationAssigneeId = null;
        (e as any).reservationContactName = null;
        (e as any).reservationContactEmail = null;
        (e as any).reservationConfirmedBy = null;
        (e as any).reservationConfirmedNote = null;
      } else {
        (e as any).reservationAssignee = toPublicUser(e.reservationAssignee);
        if (!isPrivileged) (e as any).reservationContactEmail = null;
      }

      const hasGoingRsvp = myRsvpMap.get(e.id) === RsvpStatus.GOING;
      if (e.location && !this.locationVisibility.canViewAddressSync(e.location, isPrivileged, hasGoingRsvp)) {
        e.locationAddress = null as unknown as string;
        e.locationLat = null;
        e.locationLng = null;
        (e.location as any).address = null;
        (e.location as any).lat = null;
        (e.location as any).lng = null;
        // Withhold photos too — a private venue's picture can reveal it.
        (e.location as any).photos = [];
      }

      return Object.assign(e, {
        goingCount: goingCountMap.get(e.id) ?? 0,
        totalAttending: totalMap.get(e.id) ?? 0,
        attendeeSnippet: isValidatedMember ? (snippetMap.get(e.id) ?? []) : [],
        myRsvpStatus: myRsvpMap.get(e.id) ?? null,
      });
    });
  }

  async findOne(id: number, callerRole?: UserRole, callerId?: number): Promise<EventDetailRow & { publicRsvps: Pick<EventGuestLink, 'id' | 'recipientName' | 'cancelledAt'>[] }> {
    const event = await this.prisma.events.findFirst({
      where: { id },
      include: {
        city: true,
        // Keep photos[0] ("the cover photo") consistent with findAll's ordering.
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
        createdByUser: true,
        rsvps: { include: { user: true, guestLinks: true } },
        reservationAssignee: true,
      },
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);

    const isValidatedMember = callerRole != null && callerRole !== UserRole.NON_VALIDATED;
    const isPrivileged = callerRole === UserRole.ADMIN || callerRole === UserRole.MODERATOR;

    const hasGoingRsvp =
      callerId != null &&
      (event.rsvps?.some((r) => r.userId === callerId && r.status === RsvpStatus.GOING) ?? false);
    if (event.location && !this.locationVisibility.canViewAddressSync(event.location, isPrivileged, hasGoingRsvp)) {
      event.locationAddress = null as unknown as string;
      event.locationLat = null;
      event.locationLng = null;
      (event.location as any).address = null;
      (event.location as any).lat = null;
      (event.location as any).lng = null;
      // A private venue's photos can reveal the address too (Street View, a
      // house shot) — withhold them until the viewer earns visibility. Emptied
      // server-side so the image URLs never reach the client.
      (event.location as any).photos = [];
    }

    // Unauthenticated/non-validated callers don't get to know member identities
    // at all; validated members can see who's going (name/photo) but never the
    // other attendee's raw account (password hash, calendar token, etc.).
    if (event.rsvps) {
      for (const rsvp of event.rsvps) {
        (rsvp as any).user = isValidatedMember ? toPublicUser(rsvp.user) : null;
      }
    }

    // Never expose the raw createdByUser/reservationAssignee entities (password
    // hash, calendar token, email, etc.) — reduce to safe display fields.
    (event as any).createdByUser = toPublicUser(event.createdByUser);
    (event as any).reservationAssignee = toPublicUser(event.reservationAssignee);

    // The confirm token is only used in the email confirm-link flow and should
    // never appear in a general read.
    delete (event as any).reservationConfirmToken;

    // The whole Reservation Coordinator panel is a members-only feature —
    // unauthenticated and non-validated (guest) callers get none of it, not
    // just the contact email.
    if (!isValidatedMember) {
      (event as any).reservationAssignee = null;
      (event as any).reservationAssigneeId = null;
      (event as any).reservationContactName = null;
      (event as any).reservationContactEmail = null;
      (event as any).reservationConfirmedBy = null;
      (event as any).reservationConfirmedNote = null;
    } else if (!isPrivileged) {
      // Validated members can see who's coordinating, but the contact email
      // is only for admins/moderators managing the reservation.
      (event as any).reservationContactEmail = null;
    }

    const publicRsvps = await this.prisma.event_guest_links.findMany({
      where: { eventId: id, source: 'public', cancelledAt: null },
      select: { id: true, recipientName: true, cancelledAt: true },
      orderBy: { createdAt: 'asc' },
    });

    return Object.assign(event, { publicRsvps });
  }

  async create(dto: CreateEventDto, userId: number): Promise<EventRow> {
    const location = await this.prisma.locations.findFirst({
      where: { id: dto.locationId },
      include: {
        city: true,
      },
    });
    if (!location) throw new NotFoundException(`Restaurant ${dto.locationId} not found`);

    const data: Prisma.eventsUncheckedCreateInput = ({
      cityId: dto.cityId,
      locationId: location.id,
      locationName: location.name,
      locationAddress: location.address,
      locationLat: location.lat,
      locationLng: location.lng,
      title: dto.title,
      description: dto.description ?? null,
      additionalInfo: dto.additionalInfo ?? null,
      // DATE/TIME columns: the DTO carries 'YYYY-MM-DD' and 'HH:MM' strings,
      // Prisma wants Date objects anchored to UTC.
      eventDate: toDateColumn(dto.eventDate),
      eventTime: toTimeColumn(dto.eventTime),
      status: dto.status ?? EventStatus.DRAFT,
      isSecret: dto.isSecret ?? false,
      createdById: userId,
    });

    if (data.status === EventStatus.PUBLISHED) {
      data.publishedAt = new Date();
    }

    return this.prisma.events.create({ data });
  }

  async update(id: number, dto: UpdateEventDto, callerRole?: UserRole): Promise<EventRow & { secretDinnerResync?: SecretDinnerResync }> {
    const event = await this.findOne(id, callerRole);

    const isRestoring = event.status === EventStatus.CANCELLED && dto.status === EventStatus.DRAFT;
    if (event.status === EventStatus.CANCELLED && !isRestoring) {
      throw new BadRequestException('Cannot edit a cancelled event');
    }

    const wasPublished = event.status === EventStatus.PUBLISHED;
    const wasSecret = event.isSecret;

    // Track meaningful changes for update-notification email
    // Both sides compared as strings: the stored values are Dates under
    // Prisma, and the DTO sends 'YYYY-MM-DD' / 'HH:MM'.
    const changedDate =
      dto.eventDate !== undefined && dto.eventDate !== toDateString(event.eventDate);
    const changedTime =
      dto.eventTime !== undefined && dto.eventTime !== toTimeString(event.eventTime).substring(0, 5);
    const changedLocation = dto.locationId !== undefined && dto.locationId !== event.locationId;

    if (dto.cityId !== undefined) event.cityId = dto.cityId;

    if (dto.locationId && dto.locationId !== event.locationId) {
      const location = await this.prisma.locations.findUnique({
        where: { id: dto.locationId },
      });
      if (!location) throw new NotFoundException(`Restaurant ${dto.locationId} not found`);
      // No relation object to set: the patch below carries locationId, and
      // Prisma writes the column directly rather than inferring it from a
      // loaded relation the way TypeORM's save() did.
      event.locationId = location.id;
      event.locationName = location.name;
      event.locationAddress = location.address;
      event.locationLat = location.lat;
      event.locationLng = location.lng;
    }

    if (dto.title !== undefined) event.title = dto.title;
    if ('description' in dto) event.description = dto.description ?? null;
    if ('additionalInfo' in dto) event.additionalInfo = dto.additionalInfo ?? null;
    if ('facebookShareText' in dto) event.facebookShareText = dto.facebookShareText ?? null;
    if (dto.isSecret !== undefined) event.isSecret = dto.isSecret;
    if (dto.eventDate !== undefined) event.eventDate = toDateColumn(dto.eventDate);
    if (dto.eventTime !== undefined) event.eventTime = toTimeColumn(dto.eventTime);

    if (dto.status !== undefined && dto.status !== event.status) {
      if (dto.status === EventStatus.PUBLISHED && !wasPublished) {
        event.publishedAt = new Date();
        void this.calendarService.invalidateAll();
      }
      if (dto.status === EventStatus.CANCELLED) {
        event.cancelledAt = new Date();
        event.cancelledReason = dto.cancelledReason ?? null;
      }
      event.status = dto.status;
    }

    // The in-memory row was mutated above exactly as before; only the write
    // changes. Naming the columns keeps the loaded relations out of the patch.
    await this.prisma.events.update({
      where: { id: event.id },
      data: {
        cityId: event.cityId,
        locationId: event.locationId,
        locationName: event.locationName,
        locationAddress: event.locationAddress,
        locationLat: event.locationLat,
        locationLng: event.locationLng,
        title: event.title,
        description: event.description,
        additionalInfo: event.additionalInfo,
        facebookShareText: event.facebookShareText,
        isSecret: event.isSecret,
        eventDate: event.eventDate,
        eventTime: event.eventTime,
        status: event.status,
        publishedAt: event.publishedAt,
        cancelledAt: event.cancelledAt,
        cancelledReason: event.cancelledReason,
      },
    });

    // Reload with fresh relations so the response reflects any location/city change
    const saved = await this.findOne(event.id, callerRole);

    if (saved.status === EventStatus.CANCELLED && wasPublished) {
      void this.sendCancellationEmails(saved);
      void this.calendarService.invalidateAll();
    } else if (wasPublished && saved.status === EventStatus.PUBLISHED && (changedDate || changedTime || changedLocation)) {
      void this.sendUpdateEmails(saved);
      void this.calendarService.invalidateAll();
    } else if (!wasPublished && saved.status === EventStatus.PUBLISHED) {
      void this.sendPublishInvites(saved);
    }

    let secretDinnerResync: SecretDinnerResync | undefined;
    if (dto.isSecret !== undefined && dto.isSecret !== wasSecret) {
      secretDinnerResync = await this.pointsService.resyncSecretDinnerForEvent(event.id, dto.isSecret);
    }

    return { ...saved, secretDinnerResync };
  }

  private async sendCancellationEmails(event: EventWithLocation): Promise<void> {
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);

    const reasonBlock = event.cancelledReason
      ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fff3e0;border-left:3px solid #e65100;border-radius:4px;font-size:0.9rem;color:#444">${event.cancelledReason}</p>`
      : '';

    const buildHtml = (recipientName: string) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#c62828;line-height:1.2">This event has been cancelled</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:20px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span>${event.locationName}
      </td></tr>
    </table>
    ${reasonBlock}
    <p style="margin:20px 0 0;font-size:0.88rem;color:#888">We hope to see you at the next ${brandName} ${eventSingularLower}!</p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    // Members who RSVPd
    const rsvps = await this.prisma.event_rsvps.findMany({
      where: { eventId: event.id },
      include: {
        user: true,
      },
    });
    for (const rsvp of rsvps) {
      if (!rsvp.user?.email) continue;
      await this.emailService.queue({
        toEmail: rsvp.user.email,
        toName: rsvp.user.fullName,
        subject: `Cancelled: ${event.title}`,
        htmlBody: buildHtml(rsvp.user.fullName),
      });
    }

    // Guest link holders (member-invited + public RSVPs) with an email who haven't already cancelled
    const guestLinks = await this.prisma.event_guest_links.findMany({
      where: { eventId: event.id, cancelledAt: null },
    });
    for (const link of guestLinks) {
      if (!link.recipientEmail) continue;
      const name = link.recipientName ?? link.recipientEmail;
      await this.emailService.queue({
        toEmail: link.recipientEmail,
        toName: name,
        subject: `Cancelled: ${event.title}`,
        htmlBody: buildHtml(name),
      });
    }
  }

  private async sendUpdateEmails(event: EventWithLocation): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    const buildHtml = (recipientName: string, showAddress: boolean) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">Event details have been updated</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.locationName}${showAddress && event.locationAddress ? ` — ${event.locationAddress}` : ''}
      </td></tr>
    </table>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View Updated Event</a>
    </p>
    <p style="margin:0;font-size:0.85rem;color:#888">If you can no longer attend, you can update your RSVP on the event page.</p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const rsvps = await this.prisma.event_rsvps.findMany({
      where: { eventId: event.id },
      include: {
        user: true,
      },
    });
    for (const rsvp of rsvps) {
      if (!rsvp.user?.email) continue;
      const showAddress = this.locationVisibility.canViewAddressSync(
        event.location ?? { id: -1, isPrivate: false },
        this.locationVisibility.isAdminOrMod(rsvp.user),
        rsvp.status === RsvpStatus.GOING,
      );
      await this.emailService.queue({
        toEmail: rsvp.user.email,
        toName: rsvp.user.fullName,
        subject: `Updated: ${event.title}`,
        htmlBody: buildHtml(rsvp.user.fullName, showAddress),
      });
    }

    const guestLinks = await this.prisma.event_guest_links.findMany({
      where: { eventId: event.id, cancelledAt: null },
      include: {
        memberRsvp: true,
      },
    });
    for (const link of guestLinks) {
      if (!link.recipientEmail) continue;
      const name = link.recipientName ?? link.recipientEmail;
      // A public/self-service guest RSVP is itself a confirmed "Going" —
      // a member-invited guest link inherits the inviting member's status.
      const showAddress =
        link.source === 'public' ||
        this.locationVisibility.canViewAddressSync(
          event.location ?? { id: -1, isPrivate: false },
          false,
          link.memberRsvp?.status === RsvpStatus.GOING,
        );
      await this.emailService.queue({
        toEmail: link.recipientEmail,
        toName: name,
        subject: `Updated: ${event.title}`,
        htmlBody: buildHtml(name, showAddress),
      });
    }
  }

  async remove(id: number): Promise<void> {
    const event = await this.findOne(id);
    if (event.status === EventStatus.PUBLISHED) {
      throw new BadRequestException('Cannot delete a published event — cancel it first');
    }
    await this.prisma.events.delete({ where: { id: event.id } });
  }

  async upsertRsvp(
    eventId: number,
    userId: number,
    status: RsvpStatus,
    additionalGuests: number,
    guestNames?: string[],
    bringingItem?: string,
    userRole?: UserRole,
  ): Promise<EventRsvp> {
    const event = await this.prisma.events.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Can only RSVP to published events');
    }

    // Block RSVPs to events that have already passed
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const getPart = (type: string) => nowParts.find((p) => p.type === type)?.value ?? '0';
    const todayEastern = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    if (toDateString(event.eventDate) < todayEastern) {
      throw new BadRequestException('Cannot RSVP to a past event');
    }

    const existing = await this.prisma.event_rsvps.findFirst({ where: { eventId, userId } });

    const isPastCutoff = isPastRsvpCutoff(toDateString(event.eventDate), toTimeString(event.eventTime));
    const isPrivileged = userRole === UserRole.ADMIN || userRole === UserRole.MODERATOR;

    // Block upgrading to GOING after cutoff — applies to new RSVPs and existing non-Going RSVPs
    if (status === RsvpStatus.GOING &&
        existing?.status !== RsvpStatus.GOING &&
        isPastCutoff && !isPrivileged) {
      throw new ForbiddenException('RSVP is closed — the deadline has passed');
    }

    // Block increasing guest count after cutoff — already-Going users can decrease but not add
    if (status === RsvpStatus.GOING &&
        existing?.status === RsvpStatus.GOING &&
        additionalGuests > existing.additionalGuests &&
        isPastCutoff && !isPrivileged) {
      throw new ForbiddenException('RSVP is closed — cannot increase guest count after the deadline');
    }

    // Membership fee (Phase 35): once a member has attended at least one event
    // (their free first meeting), a Going RSVP requires an active, non-expired
    // membership. Maybe is never blocked — only a Going RSVP unlocks address/
    // location visibility, so gating Maybe wouldn't serve the fee's purpose.
    if (status === RsvpStatus.GOING && !isPrivileged) {
      const requireMembership = await this.appConfig.isFeatureEnabled('feature_require_membership');
      if (requireMembership) {
        const user = await this.prisma.users.findFirst({ where: { id: userId } });
        const hasActiveMembership = !!user?.hasMembership &&
          !!user.membershipExpiresAt &&
          user.membershipExpiresAt > new Date();
        if (!hasActiveMembership) {
          const hasAttendedBefore = (await this.prisma.event_rsvps.count({ where: { userId, attended: true } })) > 0;
          if (hasAttendedBefore) {
            throw new ForbiddenException(
              'An active membership is required to RSVP — your first meeting is free, but this one needs a membership. Contact an admin.',
            );
          }
        }
      }
    }

    let saved: EventRsvp;
    if (existing) {
      const patch: Prisma.event_rsvpsUncheckedUpdateInput = { status, additionalGuests };
      if (guestNames !== undefined) {
        patch.guestNames = guestNames.length > 0 ? guestNames : Prisma.DbNull;
      }
      if (bringingItem !== undefined) {
        patch.bringingItem = bringingItem.trim() || null;
      }
      saved = await this.prisma.event_rsvps.update({ where: { id: existing.id }, data: patch });
    } else {
      saved = await this.prisma.event_rsvps.create({
        data: ({
          eventId,
          userId,
          status,
          additionalGuests,
          guestNames: guestNames && guestNames.length > 0 ? guestNames : Prisma.DbNull,
          bringingItem: bringingItem?.trim() || null,
        }),
      });
    }

    this.calendarService.invalidateForUser(userId);

    // Send .ics confirmation when a member newly commits to Going
    const wasGoingBefore = existing?.status === RsvpStatus.GOING;
    if (status === RsvpStatus.GOING && !wasGoingBefore) {
      void this.sendRsvpConfirmation(event, userId);
    }

    return saved;
  }

  private async sendPublishInvites(event: EventWithLocation): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    // Every recipient here is, by construction, someone who hasn't RSVP'd yet
    // (see the rsvpedIds filter below) — so for a private location, none of
    // them have earned address visibility regardless of role.
    const addressVisible = !event.location?.isPrivate;
    const locationAddress = addressVisible ? event.locationAddress : null;

    // Auto-invite opt-in: 'all' takes every event, 'city' only this event's
    // city. The grouping matters -- flattening it would send city-only members
    // invitations for other cities.
    const members = await this.prisma.users.findMany({
      where: {
        // The original filtered `status IN ('active','non_validated')`, but
        // non_validated is a ROLE, not a status -- the status enum only has
        // active/suspended/deleted, so that arm never matched anything and the
        // effective filter was always status = 'active'. Preserved as-is: if
        // non-validated members are meant to receive auto-invites, that is a
        // deliberate change against users.role, not something to slip into a
        // refactor.
        status: UserStatus.ACTIVE,
        OR: [
          { calendarAutoInvite: 'all' },
          { calendarAutoInvite: 'city', cityId: event.cityId },
        ],
      },
    });

    if (members.length === 0) return;

    const existingRsvps = await this.prisma.event_rsvps.findMany({ where: { eventId: event.id }, select: { userId: true } });
    const rsvpedIds = new Set(existingRsvps.map((r) => r.userId));

    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    for (const member of members) {
      if (!member.email || rsvpedIds.has(member.id)) continue;
      if (['bounced', 'complained'].includes(member.emailStatus as string)) continue;

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${member.fullName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You're invited to ${eventSingularLower}! 🐻</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.locationName}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay} ET
      </td></tr>
      ${locationAddress ? `<tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${locationAddress}
      </td></tr>` : ''}
    </table>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#555">Open the attached calendar invite to Accept, Maybe, or Decline — your RSVP will update automatically. Or tap the button below to RSVP on the ${brandName} site.</p>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View &amp; RSVP</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

      const icsContent = await this.calendarService.buildInviteAttachment(
        event,
        { name: member.fullName, email: member.email },
        appUrl,
        locationAddress,
      );

      await this.emailService.sendNow({
        toEmail: member.email,
        toName: member.fullName,
        subject: `${brandName} ${eventSingularLower} at ${event.locationName} — ${dateDisplay}`,
        htmlBody: html,
        attachments: [{ content: icsContent, name: 'dinner-invite.ics', contentType: 'text/calendar; method=REQUEST' }],
      }).catch((err: unknown) => {
        this.logger.warn(`Publish invite failed for ${member.email}: ${(err as Error)?.message}`);
      });
    }
  }

  private async sendRsvpConfirmation(event: EventRow, userId: number): Promise<void> {
    const user = await this.prisma.users.findFirst({ where: { id: userId } });
    if (!user?.email) return;

    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${user.fullName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You're going! 🎉</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.locationName}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay} ET
      </td></tr>
      ${event.locationAddress ? `<tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.locationAddress}
      </td></tr>` : ''}
    </table>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#555">A calendar invite is attached — open it to add this ${eventSingularLower} to your calendar. You can Accept, Maybe, or Decline directly from the invite.</p>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View Event</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const icsContent = await this.calendarService.buildInviteAttachment(
      event,
      { name: user.fullName, email: user.email },
      appUrl,
    );

    await this.emailService.sendNow({
      toEmail: user.email,
      toName: user.fullName,
      subject: `You're going to ${brandName} at ${event.locationName}!`,
      htmlBody: html,
      attachments: [{ content: icsContent, name: 'dinner-invite.ics', contentType: 'text/calendar; method=REQUEST' }],
    }).catch((err: unknown) => {
      this.logger.warn(`RSVP confirmation email failed for user ${userId}: ${(err as Error)?.message}`);
    });
  }

  async removeRsvp(eventId: number, userId: number): Promise<void> {
    const rsvp = await this.prisma.event_rsvps.findFirst({ where: { eventId, userId } });
    if (rsvp) {
      await this.prisma.event_rsvps.delete({ where: { id: rsvp.id } });
      this.calendarService.invalidateForUser(userId);
    }
  }

  async getGuestLink(token: string) {
    const link = await this.prisma.event_guest_links.findFirst({
      where: { token },
      include: {
        event: { include: {
          location: { include: {
            photos: true,
          } },
        } },
        createdBy: true,
      },
    });
    if (!link) throw new NotFoundException('Guest link not found');

    const event = link.event;
    const photoUrl = event.location?.photos?.[0]?.filePath ?? null;
    // A guest link is inherently pre-RSVP and unauthenticated, so a private
    // location's address is always withheld here.
    const addressVisible = this.locationVisibility.canViewAddressSync(
      event.location ?? { id: -1, isPrivate: false },
      false,
      false,
    );

    return {
      eventTitle: event.title,
      // Kept as the 'YYYY-MM-DD' / 'HH:MM:SS' strings the API has always
      // returned; the raw Dates would serialise as full ISO timestamps.
      eventDate: toDateString(event.eventDate),
      eventTime: toTimeString(event.eventTime),
      eventStatus: event.status,
      locationName: event.locationName,
      locationAddress: addressVisible ? event.locationAddress : null,
      locationLat: addressVisible && event.locationLat !== null ? Number(event.locationLat) : null,
      locationLng: addressVisible && event.locationLng !== null ? Number(event.locationLng) : null,
      locationPhotoUrl: photoUrl,
      invitedByName: link.createdBy?.fullName ?? (await this.appConfig.getSiteSetting('brand_name')),
      recipientName: link.recipientName,
      usedAt: link.usedAt,
      cancelledAt: link.cancelledAt,
      expiresAt: link.expiresAt,
    };
  }

  async removeGuestLink(linkId: number, userId: number): Promise<void> {
    const link = await this.prisma.event_guest_links.findFirst({
      where: { id: linkId },
      include: {
        memberRsvp: { include: {
          guestLinks: true,
        } },
      },
    });
    if (!link) throw new NotFoundException('Link not found');

    const rsvp = link.memberRsvp;
    if (!rsvp) throw new BadRequestException('Cannot remove a public guest RSVP this way');
    if (rsvp.userId !== userId) throw new ForbiddenException('Not your RSVP');

    // Find this link's position in the sorted array to know which name to drop
    const sorted = [...rsvp.guestLinks].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const idx = sorted.findIndex((l) => l.id === linkId);

    // guest_names is a Json column, so Prisma types it as JsonValue. It has
    // only ever held an array of names.
    const guestNames = (rsvp.guestNames as string[] | null) ?? null;
    const remainingGuests = Math.max(0, rsvp.additionalGuests - 1);
    if (guestNames && idx >= 0 && idx < guestNames.length) {
      guestNames.splice(idx, 1);
    }
    const nextGuestNames = guestNames && guestNames.length > 0 ? guestNames : null;

    // Removing the guest link and decrementing the member's guest count are
    // one change: leaving either half applied would misstate the headcount.
    await this.prisma.$transaction([
      this.prisma.event_guest_links.delete({ where: { id: link.id } }),
      this.prisma.event_rsvps.update({
        where: { id: rsvp.id },
        data: {
          additionalGuests: remainingGuests,
          guestNames: nextGuestNames === null ? Prisma.DbNull : nextGuestNames,
        },
      }),
    ]);
  }

  async cancelGuestRsvp(token: string): Promise<void> {
    const link = await this.prisma.event_guest_links.findFirst({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');
    await this.prisma.event_guest_links.update({
      where: { id: link.id },
      data: { cancelledAt: new Date() },
    });
  }

  async useGuestLink(token: string, guestName?: string): Promise<{ message: string }> {
    const link = await this.prisma.event_guest_links.findFirst({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (link.usedAt && !link.cancelledAt) throw new BadRequestException('This link has already been used');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');

    await this.prisma.event_guest_links.update({
      where: { id: link.id },
      data: {
        usedAt: new Date(),
        cancelledAt: null,
        ...(guestName?.trim() ? { recipientName: guestName.trim() } : {}),
      },
    });
    return { message: 'RSVP confirmed' };
  }

  private formatEventTimeDisplay(hour: number, minute: number): string {
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  // locationAddress override lets callers pass '' when the viewer/recipient
  // hasn't earned visibility into a private location's address — otherwise
  // this "Add to Calendar" link would leak it even when the email body itself
  // was correctly redacted.
  private buildGoogleCalendarUrl(event: EventRow, locationAddress = event.locationAddress): string {
    const [y, m, d] = toDateString(event.eventDate).split('-').map(Number);
    const [h, min] = toTimeString(event.eventTime).split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const end = `${y}${pad(m)}${pad(d)}T${pad(h + 2)}${pad(min)}00`;
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const details: string[] = [`🍽️ ${event.locationName}`];
    if (event.description) details.push(event.description);
    if (event.additionalInfo) details.push(event.additionalInfo);
    details.push(`View event: ${appUrl}/events/${event.id}`);
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: event.title,
      dates: `${start}/${end}`, location: locationAddress,
      details: details.join('\n\n'),
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  private buildGuestEmail(params: {
    appUrl: string;
    brandName: string;
    tagline: string;
    eventSingularLower: string;
    logoUrl: string;
    inviterName: string | null;
    subject: string;
    eventTitle: string;
    eventDateDisplay: string;
    eventTimeDisplay: string;
    locationName: string;
    locationAddress: string;
    locationLat: number | null;
    locationLng: number | null;
    photoUrl: string | null;
    description: string | null;
    additionalInfo: string | null;
    manageUrl: string;
    googleCalUrl: string;
    icsUrl: string;
  }): string {
    const {
      appUrl, brandName, tagline, eventSingularLower, logoUrl, inviterName, eventTitle, eventDateDisplay, eventTimeDisplay,
      locationName, locationAddress, locationLat, locationLng,
      photoUrl, description, additionalInfo, manageUrl, googleCalUrl, icsUrl,
    } = params;

    const mapsUrl = (locationLat && locationLng)
      ? `https://www.google.com/maps?q=${locationLat},${locationLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationAddress)}`;

    const icsHost = appUrl.replace(/^https?:\/\//, '');
    const appleCalUrl = `webcal://${icsHost}${icsUrl.replace(appUrl, '')}`;

    const photoRow = photoUrl
      ? `<tr><td style="padding:0;line-height:0"><img src="${appUrl}${photoUrl}" alt="${locationName}" width="600" style="display:block;width:100%;max-height:260px;object-fit:cover" /></td></tr>`
      : '';

    const inviterRow = inviterName
      ? `<p style="margin:0 0 16px;font-size:1rem;color:#6B4226">🎉 <strong>${inviterName}</strong> invited you to ${eventSingularLower}!</p>`
      : `<p style="margin:0 0 16px;font-size:1rem;color:#6B4226">🎉 You're on the guest list for a ${brandName} ${eventSingularLower}!</p>`;

    const descriptionBlock = description
      ? `<p style="margin:16px 0 0;font-size:0.95rem;color:#444;line-height:1.6">${description}</p>`
      : '';

    const additionalInfoBlock = additionalInfo
      ? `<p style="margin:12px 0 0;font-size:0.88rem;color:#666;line-height:1.5;padding:10px 14px;background:#f5edd8;border-radius:6px">${additionalInfo}</p>`
      : '';

    const btn = (href: string, label: string, bg: string, fg: string) =>
      `<a href="${href}" style="display:inline-block;padding:8px 16px;background:${bg};color:${fg};text-decoration:none;border-radius:6px;font-size:0.8rem;font-weight:600;border:1px solid ${bg}">${label}</a>`;

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">

  <!-- Header -->
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>

  <!-- Hero photo -->
  ${photoRow}

  <!-- Content -->
  <tr><td style="padding:32px 36px 24px">
    ${inviterRow}
    <h1 style="margin:0 0 20px;font-size:1.5rem;font-weight:700;color:#3D1C05;line-height:1.2">${eventTitle}</h1>

    <!-- Details card -->
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:20px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>
        <strong>${eventDateDisplay}</strong> at ${eventTimeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span>${locationName}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${locationAddress}</a>
      </td></tr>
    </table>

    ${descriptionBlock}
    ${additionalInfoBlock}

    <!-- Manage RSVP button -->
    <div style="text-align:center;margin:28px 0 20px">
      <a href="${manageUrl}" style="display:inline-block;padding:14px 32px;background:#C9933A;color:#fff;text-decoration:none;border-radius:8px;font-size:1rem;font-weight:700">
        Manage Your RSVP
      </a>
    </div>

    <!-- Calendar -->
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-top:20px">
      <tr><td style="padding:14px 16px">
        <p style="margin:0 0 10px;font-size:0.8rem;font-weight:700;color:#3D1C05;text-transform:uppercase;letter-spacing:0.05em">Add to Calendar</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${btn(googleCalUrl, '📅 Google Calendar', '#fff', '#1a73e8')}
          &nbsp;
          ${btn(appleCalUrl, '🗓 Apple Calendar', '#fff', '#1d1d1f')}
          &nbsp;
          ${btn(`${appUrl}${icsUrl.replace(appUrl, '')}`, '⬇ Download .ics', '#fff', '#555')}
        </div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0 0 6px;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
    <p style="margin:0;font-size:0.72rem;color:#bbb">This link is yours — don't share it. It expires when the event starts.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  private buildIcs(
    event: EventRow,
    brand: { brandName: string; eventSingular: string },
    descriptionSuffix?: string,
  ): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, eventSingular } = brand;

    const startUtc = eventTimeToUtc(toDateString(event.eventDate), toTimeString(event.eventTime));
    const endUtc = new Date(startUtc.getTime() + EVENT_DURATION_MS);

    const lastMod = toIcsUtcString(new Date(event.updatedAt));
    const sequence = Math.floor(new Date(event.updatedAt).getTime() / 60000) % 999999;

    const descParts: string[] = [`🍽️ ${event.locationName}`];
    if (event.locationAddress) descParts.push(event.locationAddress);
    if (event.description) descParts.push('', event.description);
    if (event.additionalInfo) descParts.push('', event.additionalInfo);
    if (descriptionSuffix) descParts.push('', descriptionSuffix);

    const location = event.locationAddress
      ? `${event.locationName}, ${event.locationAddress}`
      : event.locationName;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${brandName}//${brandName} Calendar//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTART:${toIcsUtcString(startUtc)}`,
      `DTEND:${toIcsUtcString(endUtc)}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      `STATUS:${event.status === EventStatus.CANCELLED ? 'CANCELLED' : 'CONFIRMED'}`,
      foldIcsLine(`SUMMARY:${icsEscape(`${brandName} ${eventSingular} at ${event.locationName}`)}`),
      foldIcsLine(`LOCATION:${icsEscape(location)}`),
      foldIcsLine(`DESCRIPTION:${icsEscape(descParts.join('\n'))}`),
      foldIcsLine(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=${brandName}:mailto:${eventOrganizerEmail(this.config)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  async generateIcs(id: number): Promise<string> {
    const event = await this.findOne(id);
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, eventSingular } = await this.getEmailBrand();
    return this.buildIcs(event, { brandName, eventSingular }, `View event: ${appUrl}/events/${id}`);
  }

  async generateGuestIcs(token: string): Promise<{ ics: string; eventId: number }> {
    const link = await this.prisma.event_guest_links.findFirst({
      where: { token },
      include: {
        event: true,
      },
    });
    if (!link) throw new NotFoundException('Guest link not found');
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const manageUrl = `${appUrl}/rsvp-guest?token=${token}`;
    const { brandName, eventSingular } = await this.getEmailBrand();
    const ics = this.buildIcs(link.event, { brandName, eventSingular }, `Manage your RSVP: ${manageUrl}`);
    return { ics, eventId: link.event.id };
  }

  async generateGuestLink(
    eventId: number,
    userId: number,
    recipientName?: string,
    recipientEmail?: string,
  ): Promise<EventGuestLink> {
    const event = await this.prisma.events.findFirst({
      where: { id: eventId },
      include: {
        // Keep photos[0] ("the cover photo") consistent with findAll/findOne's ordering.
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
      },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Event is not published');
    }

    const rsvp = await this.prisma.event_rsvps.findFirst({
      where: { eventId, userId },
      include: { user: true },
    });
    if (!rsvp) throw new BadRequestException('You must RSVP before generating a guest link');

    const existingLinks = await this.prisma.event_guest_links.count({ where: { memberRsvpId: rsvp.id } });
    if (existingLinks >= rsvp.additionalGuests) {
      throw new BadRequestException(
        `You already have ${existingLinks} guest link(s) — increase your additional guests count to generate more`,
      );
    }

    const token = randomBytes(20).toString('hex');

    const [y, m, d] = toDateString(event.eventDate).split('-').map(Number);
    const [h, min] = toTimeString(event.eventTime).split(':').map(Number);
    const expiresAt = new Date(y, m - 1, d, h, min);

    const linkData: Prisma.event_guest_linksUncheckedCreateInput = ({
      eventId,
      createdById: userId,
      memberRsvpId: rsvp.id,
      deliveryType: 'shareable',
      recipientName: recipientName ?? null,
      recipientEmail: recipientEmail ?? null,
      token,
      expiresAt,
    });

    const saved = await this.prisma.event_guest_links.create({ data: linkData });

    // Fire-and-forget — email delivery is best-effort and must not block returning the link
    if (recipientEmail) {
      const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
      const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
      const manageUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
      const icsUrl = `${appUrl}/api/v1/events/guest-ics/${saved.token}`;

      const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
      const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
      const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
      const photoUrl = event.location?.photos?.[0]?.filePath ?? null;
      const inviterName = rsvp.user?.fullName ?? null;
      // The inviting member already has legitimate access (they RSVP'd Going
      // themselves); a guest they personally invite inherits that visibility.
      const addressVisible = this.locationVisibility.canViewAddressSync(
        event.location ?? { id: -1, isPrivate: false },
        false,
        rsvp.status === RsvpStatus.GOING,
      );

      void this.emailService.queue({
        toEmail: recipientEmail,
        toName: recipientName ?? undefined,
        subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
        htmlBody: this.buildGuestEmail({
          appUrl,
          brandName,
          tagline,
          eventSingularLower,
          logoUrl,
          inviterName,
          subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
          eventTitle: event.title,
          eventDateDisplay,
          eventTimeDisplay,
          locationName: event.locationName ?? '',
          locationAddress: addressVisible ? (event.locationAddress ?? '') : '',
          // lat/lng are DECIMAL columns, which Prisma returns as Decimal
          // objects; the email template expects plain numbers.
          locationLat: addressVisible && event.locationLat !== null ? Number(event.locationLat) : null,
          locationLng: addressVisible && event.locationLng !== null ? Number(event.locationLng) : null,
          photoUrl,
          description: event.description ?? null,
          additionalInfo: event.additionalInfo ?? null,
          manageUrl,
          googleCalUrl: this.buildGoogleCalendarUrl(event, addressVisible ? event.locationAddress : ''),
          icsUrl,
        }),
      }).catch((err: unknown) => {
        this.logger.warn(`Failed to queue guest invite email to ${recipientEmail}: ${(err as Error)?.message}`);
      });
    }

    return saved;
  }

  async createPublicRsvp(eventId: number, name: string, email: string): Promise<void> {
    const event = await this.prisma.events.findFirst({
      where: { id: eventId },
      include: {
        city: true,
        // Keep photos[0] ("the cover photo") consistent with findAll/findOne's ordering.
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
      },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('RSVPs are not open for this event');
    }
    const now = new Date();
    const eventStart = new Date(`${toDateString(event.eventDate)}T${toTimeString(event.eventTime)}`);
    if (now >= eventStart) throw new BadRequestException('This event has already started');

    const existingMember = await this.prisma.users.findFirst({
      where: { email: email.trim().toLowerCase(), status: { not: UserStatus.DELETED } },
    });
    if (existingMember) throw new BadRequestException('already_a_member');

    const existing = await this.prisma.event_guest_links.findFirst({
      where: { eventId, recipientEmail: email.toLowerCase(), source: 'public', cancelledAt: null },
    });
    if (existing) throw new BadRequestException('An RSVP for this email already exists for this event');

    const token = randomBytes(32).toString('hex');
    const linkData: Prisma.event_guest_linksUncheckedCreateInput = ({
      eventId,
      source: 'public',
      memberRsvpId: null,
      createdById: null,
      recipientName: name.trim(),
      recipientEmail: email.trim().toLowerCase(),
      token,
      expiresAt: eventStart,
      usedAt: now,
      deliveryType: 'email',
    });
    const saved = await this.prisma.event_guest_links.create({ data: linkData });

    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const manageUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
    const icsUrl = `${appUrl}/api/v1/events/guest-ics/${saved.token}`;

    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
    const photoUrl = event.location?.photos?.[0]?.filePath ?? null;

    await this.emailService.queue({
      toEmail: email,
      toName: name,
      subject: `You're going to a ${brandName} ${eventSingularLower}!`,
      htmlBody: this.buildGuestEmail({
        appUrl,
        brandName,
        tagline,
        eventSingularLower,
        logoUrl,
        inviterName: null,
        subject: `You're going to a ${brandName} ${eventSingularLower}!`,
        eventTitle: event.title,
        eventDateDisplay,
        eventTimeDisplay,
        locationName: event.locationName ?? '',
        locationAddress: event.locationAddress ?? '',
        locationLat: event.locationLat !== null ? Number(event.locationLat) : null,
        locationLng: event.locationLng !== null ? Number(event.locationLng) : null,
        photoUrl,
        description: event.description ?? null,
        additionalInfo: event.additionalInfo ?? null,
        manageUrl,
        googleCalUrl: this.buildGoogleCalendarUrl(event),
        icsUrl,
      }),
    });
  }

  async getAttendance(eventId: number): Promise<{
    type: 'member' | 'guest';
    userId?: number;
    guestLinkId?: number;
    memberName: string;
    recipientEmail?: string | null;
    attended: boolean | null;
    isWalkin: boolean;
    fromOtherCity: boolean;
    linkUsed: boolean;
  }[]> {
    const event = await this.prisma.events.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const [rsvps, guestLinks] = await Promise.all([
      this.prisma.event_rsvps.findMany({
        where: { eventId, status: RsvpStatus.GOING },
        include: {
          user: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.event_guest_links.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const members = rsvps.map((r) => ({
      type: 'member' as const,
      userId: r.userId,
      memberName: r.user?.fullName ?? 'Member',
      // `attended` is a plain tinyint column, not TypeORM's `boolean` type — MySQL
      // hands back a raw 0/1 number here, not a real boolean. The attendance
      // dialog highlights buttons with a strict `=== true`/`=== false` check, which
      // a number never satisfies, so this must be coerced before it leaves the API.
      attended: r.attended === null ? null : !!r.attended,
      isWalkin: r.isWalkin,
      fromOtherCity: r.fromOtherCity,
      linkUsed: false,
    }));

    const guests = guestLinks
      .filter((l) => !l.cancelledAt)
      .map((l) => ({
        type: 'guest' as const,
        guestLinkId: l.id,
        memberName: l.recipientName ?? l.recipientEmail ?? 'Guest',
        recipientEmail: l.recipientEmail,
        attended: l.attended === null ? null : !!l.attended,
        isWalkin: false,
        fromOtherCity: false,
        linkUsed: !!l.usedAt,
      }));

    return [...members, ...guests];
  }

  async markAttendance(eventId: number, attendances: { userId: number; attended: boolean; fromOtherCity?: boolean }[]): Promise<void> {
    const event = await this.prisma.events.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    for (const entry of attendances) {
      const update: Prisma.event_rsvpsUncheckedUpdateInput = { attended: entry.attended };
      if (entry.fromOtherCity !== undefined) update.fromOtherCity = entry.fromOtherCity;

      // updateMany: the criteria are a guard as much as a selector -- only a
      // GOING rsvp for this event may be marked attended.
      await this.prisma.event_rsvps.updateMany({
        where: { eventId, userId: entry.userId, status: RsvpStatus.GOING },
        data: update,
      });
      if (entry.attended) {
        await this.pointsService.awardAttendance(entry.userId, eventId).catch(() => {});
        // Award coordinator if this member made the reservation
        const coordinatorId = event.reservationAssigneeId ?? null;
        if (coordinatorId === entry.userId) {
          await this.pointsService.awardCoordinator(entry.userId, eventId).catch(() => {});
        }
        // Award event-specific one-time achievement if this event has one
        await this.achievementsService.checkEventAchievement(entry.userId, eventId).catch(() => {});
        // City Hopper: mark as from another city
        if (entry.fromOtherCity) {
          await this.pointsService.awardCityHopper(entry.userId, eventId).catch(() => {});
        }
        // Secret Dinner: award if this event is marked secret
        if (event.isSecret) {
          await this.pointsService.awardSecretDinner(entry.userId, eventId).catch(() => {});
        }
      }
    }
  }

  async markGuestAttendance(guestLinkId: number, attended: boolean): Promise<void> {
    const link = await this.prisma.event_guest_links.findFirst({ where: { id: guestLinkId } });
    if (!link) throw new NotFoundException('Guest link not found');
    await this.prisma.event_guest_links.update({ where: { id: guestLinkId }, data: { attended } });
  }

  async resendGuestInvite(guestLinkId: number): Promise<void> {
    const link = await this.prisma.event_guest_links.findFirst({
      where: { id: guestLinkId },
      include: {
        event: { include: {
          location: { include: {
            photos: true,
          } },
        } },
        memberRsvp: { include: {
          user: true,
        } },
      },
    });
    if (!link) throw new NotFoundException('Guest link not found');
    if (!link.recipientEmail) throw new BadRequestException('This guest link has no email address to resend to');

    const event = link.event;
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const manageUrl = `${appUrl}/rsvp-guest?token=${link.token}`;
    const icsUrl = `${appUrl}/api/v1/events/guest-ics/${link.token}`;

    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
    const photoUrl = event.location?.photos?.[0]?.filePath ?? null;
    const inviterName = link.memberRsvp?.user?.fullName ?? null;
    const addressVisible = this.locationVisibility.canViewAddressSync(
      event.location ?? { id: -1, isPrivate: false },
      false,
      link.memberRsvp?.status === RsvpStatus.GOING,
    );

    await this.emailService.queue({
      toEmail: link.recipientEmail,
      toName: link.recipientName ?? undefined,
      subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
      htmlBody: this.buildGuestEmail({
        appUrl,
        brandName,
        tagline,
        logoUrl,
        eventSingularLower,
        inviterName,
        subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
        eventTitle: event.title,
        eventDateDisplay,
        eventTimeDisplay,
        locationName: event.locationName ?? '',
        locationAddress: addressVisible ? (event.locationAddress ?? '') : '',
        locationLat: addressVisible && event.locationLat !== null ? Number(event.locationLat) : null,
        locationLng: addressVisible && event.locationLng !== null ? Number(event.locationLng) : null,
        photoUrl,
        description: event.description ?? null,
        additionalInfo: event.additionalInfo ?? null,
        manageUrl,
        googleCalUrl: this.buildGoogleCalendarUrl(event, addressVisible ? event.locationAddress : ''),
        icsUrl,
      }),
    });
  }

  async searchMembersForWalkin(eventId: number, query: string, excludeGoing = true): Promise<{ id: number; fullName: string }[]> {
    const where: Prisma.usersWhereInput = { status: UserStatus.ACTIVE };

    if (excludeGoing) {
      const existingRsvps = await this.prisma.event_rsvps.findMany({
        where: { eventId, status: RsvpStatus.GOING },
        select: { userId: true },
      });
      const excludeIds = existingRsvps.map((r) => r.userId);
      if (excludeIds.length > 0) {
        where.id = { notIn: excludeIds };
      }
    }

    if (query.trim()) {
      where.fullName = { contains: query.trim() };
    }

    const users = await this.prisma.users.findMany({
      where,
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: 20,
    });
    return users.map((u) => ({ id: u.id, fullName: u.fullName }));
  }

  async getReservationInfo(token: string): Promise<{ eventTitle: string; locationName: string; eventDate: string; eventTime: string; inviteToken?: string }> {
    const event = await this.prisma.events.findFirst({ where: { reservationConfirmToken: token } });
    if (!event) throw new NotFoundException('Confirmation link not found');
    let inviteToken: string | undefined;
    if (event.reservationContactEmail) {
      const invite = await this.prisma.invites.findFirst({
        where: {
          type: InviteType.EVENT_INVITE,
          eventId: event.id,
          boundToEmail: event.reservationContactEmail.toLowerCase(),
          isRevoked: false,
          redeemedAt: null,
        },
      });
      if (invite) inviteToken = invite.token;
    }
    return {
      eventTitle: event.title,
      locationName: event.locationName,
      // Kept as the 'YYYY-MM-DD' / 'HH:MM:SS' strings the API has always
      // returned; the raw Dates would serialise as full ISO timestamps.
      eventDate: toDateString(event.eventDate),
      eventTime: toTimeString(event.eventTime),
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  async setReservation(eventId: number, dto: SetReservationDto, callerUser?: User): Promise<EventRow> {
    const event = await this.prisma.events.findFirst({
      where: { id: eventId },
      include: {
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
        reservationAssignee: true,
      },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    if (dto.confirmed !== undefined) {
      event.reservationConfirmed = dto.confirmed;
      if (dto.confirmed) {
        const assignedName = event.reservationAssignee?.fullName ?? event.reservationContactName;
        const callerIsAssignee = callerUser != null && event.reservationAssigneeId === callerUser.id;
        if (assignedName && callerUser && !callerIsAssignee) {
          // Admin/mod confirming on behalf of the actual assignee — record both
          event.reservationConfirmedBy = `${assignedName} (confirmed by ${callerUser.fullName})`;
        } else {
          // Assignee self-confirmed, or no specific assignee
          event.reservationConfirmedBy = assignedName ?? callerUser?.fullName ?? 'Admin';
        }
        event.reservationConfirmedAt = new Date();
        event.reservationConfirmedNote = dto.confirmedNote ?? null;
      } else {
        event.reservationConfirmedBy = null;
        event.reservationConfirmedAt = null;
        event.reservationConfirmedNote = null;
      }
    }

    if (dto.assigneeId !== undefined) {
      // Clear confirmation state on reassign
      if (event.reservationAssigneeId !== dto.assigneeId || event.reservationContactEmail) {
        event.reservationConfirmed = false;
        event.reservationConfirmedBy = null;
        event.reservationConfirmedAt = null;
        event.reservationSeatsEmailSent = false;
      }
      event.reservationAssigneeId = dto.assigneeId ?? null;
      event.reservationContactName = null;
      event.reservationContactEmail = null;
      event.reservationConfirmToken = null;

      if (dto.assigneeId) {
        const assignee = await this.prisma.users.findFirst({ where: { id: dto.assigneeId } });
        if (!assignee) throw new NotFoundException(`Member ${dto.assigneeId} not found`);
        if (assignee.email) {
          await this.sendReservationRequestEmail(event, assignee.fullName, assignee.email, null);
        }
      }
    } else if (dto.contactName !== undefined || dto.contactEmail !== undefined) {
      // Clear confirmation state on reassign
      if (event.reservationContactEmail !== dto.contactEmail || event.reservationAssigneeId) {
        event.reservationConfirmed = false;
        event.reservationConfirmedBy = null;
        event.reservationConfirmedAt = null;
        event.reservationSeatsEmailSent = false;
      }
      event.reservationAssigneeId = null;
      event.reservationContactName = dto.contactName ?? null;
      event.reservationContactEmail = dto.contactEmail ?? null;

      if (dto.contactEmail) {
        const token = randomUUID().replace(/-/g, '');
        event.reservationConfirmToken = token;
        const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
        const confirmUrl = `${appUrl}/events/reservation-confirm/${token}`;

        // Create (or reuse) an EVENT_INVITE so the outside contact can sign up
        const normalizedEmail = dto.contactEmail.toLowerCase();
        const existingInvite = await this.prisma.invites.findFirst({
          where: {
            type: InviteType.EVENT_INVITE,
            eventId: event.id,
            boundToEmail: normalizedEmail,
            isRevoked: false,
            redeemedAt: null,
          },
        });
        let inviteToken: string;
        if (existingInvite) {
          inviteToken = existingInvite.token;
        } else {
          const inviteExpiry = new Date();
          inviteExpiry.setDate(inviteExpiry.getDate() + 30);
          const newInvite = await this.prisma.invites.create({ data: ({
            token: randomBytes(50).toString('hex'),
            type: InviteType.EVENT_INVITE,
            eventId: event.id,
            boundToEmail: normalizedEmail,
            boundToName: dto.contactName ?? null,
            inviteFlavor: InviteFlavor.MEMBER,
            maxUses: 1,
            expiresAt: inviteExpiry,
            createdBy: callerUser?.id ?? 1,
            cityId: event.cityId,
          }) });
          inviteToken = newInvite.token;
        }
        const signupUrl = `${appUrl}/login?token=${inviteToken}`;
        await this.sendReservationRequestEmail(event, dto.contactName ?? dto.contactEmail, dto.contactEmail, confirmUrl, signupUrl);
      } else {
        event.reservationConfirmToken = null;
      }
    }

    // Same pattern as update(): the row was mutated above, and only the
    // reservation columns this method touches are written back.
    await this.prisma.events.update({
      where: { id: event.id },
      data: {
        reservationAssigneeId: event.reservationAssigneeId,
        reservationContactName: event.reservationContactName,
        reservationContactEmail: event.reservationContactEmail,
        reservationConfirmToken: event.reservationConfirmToken,
        reservationConfirmed: event.reservationConfirmed,
        reservationConfirmedBy: event.reservationConfirmedBy,
        reservationConfirmedAt: event.reservationConfirmedAt,
        reservationConfirmedNote: event.reservationConfirmedNote,
        reservationSeatsEmailSent: event.reservationSeatsEmailSent,
      },
    });

    // awardCoordinator() otherwise only ever fires inline, once, inside
    // markAttendance() — someone assigned as coordinator *after* their
    // attendance was already marked (e.g. once they've finished registering)
    // would never get credit without this retroactive check.
    if (dto.assigneeId) {
      const assigneeRsvp = await this.prisma.event_rsvps.findFirst({
        where: { eventId, userId: dto.assigneeId, attended: true },
      });
      if (assigneeRsvp) {
        await this.pointsService.awardCoordinator(dto.assigneeId, eventId).catch(() => {});
      }
    }

    return this.findOne(eventId, callerUser?.role);
  }

  private async sendReservationRequestEmail(
    event: EventWithLocation,
    recipientName: string,
    recipientEmail: string,
    confirmUrl: string | null,
    signupUrl?: string,
  ): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);

    const eventUrl = `${appUrl}/events/${event.id}`;
    const ctaUrl = confirmUrl ?? eventUrl;
    const ctaLabel = confirmUrl ? 'Mark Reservation as Made' : 'View Event';

    const mapsUrl = (event.locationLat && event.locationLng)
      ? `https://www.google.com/maps?q=${event.locationLat},${event.locationLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationAddress)}`;

    const phone = event.location?.phone ?? null;
    const websiteUrl = event.location?.websiteUrl ?? null;
    const phoneRow = phone
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📞</span>
        <a href="tel:${phone}" style="color:#C9933A;text-decoration:none">${phone}</a>
      </td></tr>`
      : '';
    const websiteRow = websiteUrl
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🌐</span>
        <a href="${websiteUrl}" style="color:#C9933A;text-decoration:none">${websiteUrl}</a>
      </td></tr>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You've been asked to make the ${eventSingularLower} reservation</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span><strong>${dateDisplay}</strong> at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;${phone || websiteUrl ? 'border-bottom:1px solid #e8e0d6;' : ''}font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${event.locationName} — ${event.locationAddress}</a>
      </td></tr>
      ${phoneRow}
      ${websiteRow}
    </table>
    <p style="margin:0 0 12px;font-size:0.9rem;color:#555">
      Please call <strong>${event.locationName}</strong> and make a reservation for about
      <strong>20&ndash;25 people</strong> to start. A few things to mention when you call:
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:0.9rem;color:#555;line-height:1.7">
      <li>${brandName} members typically start arriving <strong>30 minutes early</strong>, so give them a heads-up.</li>
      <li>You'll receive a follow-up email <strong>2 hours before the event</strong> with an updated headcount &mdash; please plan to call the venue that day to confirm the final count.</li>
    </ul>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${ctaUrl}" style="background:#C9933A;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">${ctaLabel}</a>
    </p>
    <p style="margin:0;font-size:0.8rem;color:#aaa;text-align:center">
      If you have questions, reply to this email or contact the event organizer.
    </p>
    ${signupUrl ? `
    <div style="margin-top:24px;padding:16px;background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;text-align:center">
      <p style="margin:0 0 10px;font-size:0.88rem;color:#555;font-weight:600">New to ${brandName}?</p>
      <p style="margin:0 0 12px;font-size:0.85rem;color:#777">Create your account and you'll be auto-RSVPed to this ${eventSingularLower}.</p>
      <a href="${signupUrl}" style="background:#1E4D8C;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;display:inline-block">Create My Account</a>
    </div>` : ''}
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await this.emailService.queue({
      toEmail: recipientEmail,
      toName: recipientName,
      subject: `Action needed: make the reservation for ${event.title}`,
      htmlBody: html,
    });
  }

  async confirmReservation(token: string): Promise<{ eventTitle: string; locationName: string; eventDate: string; eventTime: string; inviteToken?: string }> {
    const event = await this.prisma.events.findFirst({
      where: { reservationConfirmToken: token },
    });
    if (!event) throw new NotFoundException('Confirmation link not found or already used');
    event.reservationConfirmed = true;
    event.reservationConfirmedBy = event.reservationContactName ?? 'Outside Contact';
    event.reservationConfirmedAt = new Date();
    await this.prisma.events.update({
      where: { id: event.id },
      data: {
        reservationConfirmed: true,
        reservationConfirmedBy: event.reservationConfirmedBy,
        reservationConfirmedAt: event.reservationConfirmedAt,
      },
    });
    let inviteToken: string | undefined;
    if (event.reservationContactEmail) {
      const invite = await this.prisma.invites.findFirst({
        where: {
          type: InviteType.EVENT_INVITE,
          eventId: event.id,
          boundToEmail: event.reservationContactEmail.toLowerCase(),
          isRevoked: false,
          redeemedAt: null,
        },
      });
      if (invite) inviteToken = invite.token;
    }
    return {
      eventTitle: event.title,
      locationName: event.locationName,
      // Kept as the 'YYYY-MM-DD' / 'HH:MM:SS' strings the API has always
      // returned; the raw Dates would serialise as full ISO timestamps.
      eventDate: toDateString(event.eventDate),
      eventTime: toTimeString(event.eventTime),
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  /**
   * Seats-reminder mail for reservations coming up in the next two hours, for
   * every tenant. Runs on a schedule, so there is no Host header and no tenant
   * to resolve — the sweep is deliberately deployment-wide.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  checkReservationSeatsReminders(): Promise<void> {
    return runUnscoped('reservation seats reminders sweep every tenant', () =>
      this.runReservationSeatsReminders(),
    );
  }

  private async runReservationSeatsReminders(): Promise<void> {
    // Get current Eastern time
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    const pad2 = (n: string) => n.padStart(2, '0');
    const easternNow = `${g('year')}-${pad2(g('month'))}-${pad2(g('day'))} ${pad2(g('hour'))}:${pad2(g('minute'))}:00`;

    const twoHrsLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const parts2 = fmt.formatToParts(twoHrsLater);
    const g2 = (t: string) => parts2.find((p) => p.type === t)?.value ?? '0';
    const easternPlus2 = `${g2('year')}-${pad2(g2('month'))}-${pad2(g2('day'))} ${pad2(g2('hour'))}:${pad2(g2('minute'))}:00`;

    // TIMESTAMP(event_date, event_time) combines two columns into one instant,
    // which Prisma has no expression for, so the window filter stays SQL. Only
    // the ids are fetched here; the rows themselves come back through the
    // client so the location relation is loaded the usual way.
    //
    // Deliberately carries no tenant_id predicate. This runs inside the
    // runUnscoped wrapper above, so it is meant to see every tenant's events —
    // the reminder has to go out for all of them from one scheduled pass.
    const dueRows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT e.id
      FROM events e
      WHERE e.status = ${EventStatus.PUBLISHED}
        AND e.reservation_seats_email_sent = 0
        AND (e.reservation_assignee_id IS NOT NULL OR e.reservation_contact_email IS NOT NULL)
        AND TIMESTAMP(e.event_date, e.event_time) BETWEEN ${easternNow} AND ${easternPlus2}`;

    const events = dueRows.length
      ? await this.prisma.events.findMany({
          where: { id: { in: coerceRawRows(dueRows).map((r) => r.id) } },
          include: { location: { include: { photos: { orderBy: { id: 'asc' } } } } },
        })
      : [];

    for (const event of events) {
      try {
        await this.sendSeatsReminderEmail(event);
        await this.prisma.events.update({
          where: { id: event.id },
          data: { reservationSeatsEmailSent: true },
        });
      } catch (err) {
        this.logger.error(`Seats reminder failed for event ${event.id}`, err);
      }
    }
  }

  private async sendSeatsReminderEmail(event: EventWithLocation): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();

    // Resolve recipient
    let recipientEmail: string | null = event.reservationContactEmail;
    let recipientName: string = event.reservationContactName ?? 'there';
    if (event.reservationAssigneeId) {
      const assignee = await this.prisma.users.findFirst({ where: { id: event.reservationAssigneeId } });
      if (!assignee?.email) return;
      recipientEmail = assignee.email;
      recipientName = assignee.fullName;
    }
    if (!recipientEmail) return;

    // Current going count (member RSVPs + additional guests + public RSVPs)
    const goingRsvps = await this.prisma.event_rsvps.findMany({
      where: { eventId: event.id, status: RsvpStatus.GOING },
    });
    let goingCount = goingRsvps.reduce((sum, r) => sum + 1 + r.additionalGuests, 0);
    const publicCount = await this.prisma.event_guest_links.count({
      where: { eventId: event.id, source: 'public', cancelledAt: null },
    });
    goingCount += publicCount;
    const suggestedCount = goingCount + 3;

    const [ey, em, ed] = toDateString(event.eventDate).split('-').map(Number);
    const [eh, emin] = toTimeString(event.eventTime).split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const mapsUrl = (event.locationLat && event.locationLng)
      ? `https://www.google.com/maps?q=${event.locationLat},${event.locationLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationAddress)}`;

    const rPhone = event.location?.phone ?? null;
    const rWebsite = event.location?.websiteUrl ?? null;
    const rPhoneRow = rPhone
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📞</span>
        <a href="tel:${rPhone}" style="color:#C9933A;text-decoration:none">${rPhone}</a>
      </td></tr>`
      : '';
    const rWebsiteRow = rWebsite
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🌐</span>
        <a href="${rWebsite}" style="color:#C9933A;text-decoration:none">${rWebsite}</a>
      </td></tr>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">Updated headcount for tonight's ${eventSingularLower}</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span><strong>${dateDisplay}</strong> at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${event.locationName} — ${event.locationAddress}</a>
      </td></tr>
      ${rPhoneRow}
      ${rWebsiteRow}
      <tr><td style="padding:14px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">👥</span>
        Current confirmed count: <strong>${goingCount}</strong> people
        &nbsp;&bull;&nbsp; <strong>Please update the reservation to ${suggestedCount}</strong> to allow for walk-ins
      </td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:0.9rem;color:#555">
      The event starts in about 2 hours. Please call <strong>${event.locationName}</strong> now and update the reservation
      to <strong>${suggestedCount} people</strong> (${goingCount} confirmed + 3 for walk-ins).
    </p>
    <p style="text-align:center;margin:0 0 20px">
      <a href="${appUrl}/events/${event.id}" style="background:#3D1C05;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">View Live Attendee List</a>
    </p>
    <p style="margin:0;font-size:0.8rem;color:#aaa;text-align:center">
      Thank you for coordinating the reservation!
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await this.emailService.queue({
      toEmail: recipientEmail,
      toName: recipientName,
      subject: `Headcount update for ${event.title} — please call ${event.locationName}`,
      htmlBody: html,
    });
  }

  async addWalkin(eventId: number, userId: number): Promise<{ type: 'member'; userId: number; memberName: string; attended: boolean | null; isWalkin: boolean; fromOtherCity: boolean; linkUsed: boolean }> {
    const event = await this.prisma.events.findFirst({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const user = await this.prisma.users.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundException('Member not found');

    const existing = await this.prisma.event_rsvps.findFirst({ where: { eventId, userId } });
    if (existing) {
      await this.prisma.event_rsvps.update({
        where: { id: existing.id },
        data: { attended: true, isWalkin: true },
      });
    } else {
      await this.prisma.event_rsvps.create({
        data: {
          eventId,
          userId,
          status: RsvpStatus.GOING,
          attended: true,
          isWalkin: true,
          additionalGuests: 0,
        },
      });
    }

    await this.pointsService.awardAttendance(userId, eventId).catch(() => {});
    await this.achievementsService.checkEventAchievement(userId, eventId).catch(() => {});

    return { type: 'member' as const, userId, memberName: user.fullName, attended: true, isWalkin: true, fromOtherCity: false, linkUsed: false };
  }
}
