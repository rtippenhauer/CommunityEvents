import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes, randomUUID } from 'crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { EventGuestLinkEntity } from '../../database/entities/event-guest-link.entity';
import { EventRsvpEntity, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { InviteEntity, InviteFlavor, InviteType } from '../../database/entities/invite.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { SetReservationDto } from './dto/set-reservation.dto';
import { EmailService } from '../email/email.service';
import { CalendarService } from '../calendar/calendar.service';
import { PointsService } from '../community/points.service';
import { AchievementsService } from '../community/achievements.service';
import { ConfigService } from '@nestjs/config';
import { isPastRsvpCutoff } from '../../common/utils/rsvp-cutoff.util';
import { toPublicUser } from '../../common/utils/public-user.util';
import { icsEscape, eventTimeToUtc, toIcsUtcString, foldIcsLine, EVENT_DURATION_MS } from '../../common/utils/ics.util';

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
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    @InjectRepository(EventGuestLinkEntity)
    private readonly guestLinkRepo: Repository<EventGuestLinkEntity>,
    @InjectRepository(RestaurantEntity)
    private readonly restaurantRepo: Repository<RestaurantEntity>,
    @InjectRepository(InviteEntity)
    private readonly inviteRepo: Repository<InviteEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
    private readonly pointsService: PointsService,
    private readonly achievementsService: AchievementsService,
    private readonly config: ConfigService,
  ) {}

  async findAll(filters: EventFilters): Promise<(EventEntity & { goingCount: number; totalAttending: number; attendeeSnippet: { fullName: string; profilePhotoPath: string | null }[]; myRsvpStatus: string | null })[]> {
    const qb = this.eventRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.city', 'city')
      .leftJoinAndSelect('e.restaurant', 'restaurant')
      .leftJoinAndSelect('restaurant.photos', 'photos')
      .leftJoinAndSelect('e.createdByUser', 'createdByUser');

    if (filters.cityId) {
      qb.andWhere('e.cityId = :cityId', { cityId: filters.cityId });
    }

    if (filters.status) {
      qb.andWhere('e.status = :status', { status: filters.status });
    } else if (!filters.isAdminOrMod) {
      qb.andWhere('e.status != :draft', { draft: EventStatus.DRAFT });
    }

    if (filters.fromDate) {
      qb.andWhere('e.eventDate >= :fromDate', { fromDate: filters.fromDate }).orderBy('e.eventDate', 'ASC').addOrderBy('e.eventTime', 'ASC');
    } else {
      const todayParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => todayParts.find((p) => p.type === t)?.value ?? '0';
      const today = `${get('year')}-${get('month')}-${get('day')}`;
      if (filters.upcoming === true) {
        qb.andWhere('e.eventDate >= :today', { today }).orderBy('e.eventDate', 'ASC').addOrderBy('e.eventTime', 'ASC');
      } else if (filters.upcoming === false) {
        qb.andWhere('e.eventDate < :today', { today }).orderBy('e.eventDate', 'DESC').addOrderBy('e.eventTime', 'DESC');
      } else {
        qb.orderBy('e.eventDate', 'DESC').addOrderBy('e.eventTime', 'DESC');
      }
    }

    const events = await qb.getMany();
    if (events.length === 0) {
      return events as (EventEntity & { goingCount: number; totalAttending: number; attendeeSnippet: { fullName: string; profilePhotoPath: string | null }[]; myRsvpStatus: string | null })[];
    }

    const ids = events.map((e) => e.id);

    // One query: all going+maybe RSVPs with user names for counts and avatar snippet
    const rsvpRows = await this.rsvpRepo
      .createQueryBuilder('r')
      .leftJoin('r.user', 'u')
      .select('r.eventId', 'eventId')
      .addSelect('r.status', 'status')
      .addSelect('r.additionalGuests', 'additionalGuests')
      .addSelect('u.fullName', 'fullName')
      .addSelect('u.profilePhotoPath', 'profilePhotoPath')
      .where('r.eventId IN (:...ids)', { ids })
      .andWhere('r.status IN (:...statuses)', { statuses: [RsvpStatus.GOING, RsvpStatus.MAYBE] })
      .orderBy('r.status', 'ASC')   // 'going' < 'maybe' — going first
      .addOrderBy('r.createdAt', 'ASC')
      .getRawMany<{ eventId: string; status: string; additionalGuests: string; fullName: string; profilePhotoPath: string | null }>();

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
      const myRows = await this.rsvpRepo
        .createQueryBuilder('r')
        .select('r.eventId', 'eventId')
        .addSelect('r.status', 'status')
        .where('r.eventId IN (:...ids)', { ids })
        .andWhere('r.userId = :userId', { userId: filters.userId })
        .getRawMany<{ eventId: string; status: string }>();
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
      return Object.assign(e, {
        goingCount: goingCountMap.get(e.id) ?? 0,
        totalAttending: totalMap.get(e.id) ?? 0,
        attendeeSnippet: isValidatedMember ? (snippetMap.get(e.id) ?? []) : [],
        myRsvpStatus: myRsvpMap.get(e.id) ?? null,
      });
    });
  }

  async findOne(id: number, callerRole?: UserRole): Promise<EventEntity & { publicRsvps: Pick<EventGuestLinkEntity, 'id' | 'recipientName' | 'cancelledAt'>[] }> {
    const event = await this.eventRepo.findOne({
      where: { id },
      relations: [
        'city',
        'restaurant',
        'restaurant.photos',
        'createdByUser',
        'rsvps',
        'rsvps.user',
        'rsvps.guestLinks',
        'reservationAssignee',
      ],
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);

    const isValidatedMember = callerRole != null && callerRole !== UserRole.NON_VALIDATED;
    const isPrivileged = callerRole === UserRole.ADMIN || callerRole === UserRole.MODERATOR;

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

    const publicRsvps = await this.guestLinkRepo.find({
      where: { eventId: id, source: 'public', cancelledAt: IsNull() },
      select: ['id', 'recipientName', 'cancelledAt'],
      order: { createdAt: 'ASC' },
    });

    return Object.assign(event, { publicRsvps });
  }

  async create(dto: CreateEventDto, userId: number): Promise<EventEntity> {
    const restaurant = await this.restaurantRepo.findOne({
      where: { id: dto.restaurantId },
      relations: ['city'],
    });
    if (!restaurant) throw new NotFoundException(`Restaurant ${dto.restaurantId} not found`);

    const event = this.eventRepo.create({
      cityId: dto.cityId,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      restaurantAddress: restaurant.address,
      restaurantLat: restaurant.lat,
      restaurantLng: restaurant.lng,
      title: dto.title,
      description: dto.description ?? null,
      additionalInfo: dto.additionalInfo ?? null,
      eventDate: dto.eventDate,
      eventTime: dto.eventTime,
      status: dto.status ?? EventStatus.DRAFT,
      isSecret: dto.isSecret ?? false,
      createdById: userId,
    });

    if (event.status === EventStatus.PUBLISHED) {
      event.publishedAt = new Date();
    }

    return this.eventRepo.save(event);
  }

  async update(id: number, dto: UpdateEventDto, callerRole?: UserRole): Promise<EventEntity> {
    const event = await this.findOne(id, callerRole);

    const isRestoring = event.status === EventStatus.CANCELLED && dto.status === EventStatus.DRAFT;
    if (event.status === EventStatus.CANCELLED && !isRestoring) {
      throw new BadRequestException('Cannot edit a cancelled event');
    }

    const wasPublished = event.status === EventStatus.PUBLISHED;

    // Track meaningful changes for update-notification email
    const changedDate = dto.eventDate !== undefined && dto.eventDate !== event.eventDate;
    const changedTime = dto.eventTime !== undefined && dto.eventTime !== event.eventTime.substring(0, 5);
    const changedRestaurant = dto.restaurantId !== undefined && dto.restaurantId !== event.restaurantId;

    if (dto.cityId !== undefined) event.cityId = dto.cityId;

    if (dto.restaurantId && dto.restaurantId !== event.restaurantId) {
      const restaurant = await this.restaurantRepo.findOne({
        where: { id: dto.restaurantId },
      });
      if (!restaurant) throw new NotFoundException(`Restaurant ${dto.restaurantId} not found`);
      // Must set the relation object so TypeORM uses the new FK on save,
      // not the old relation it loaded from findOne
      event.restaurant = restaurant;
      event.restaurantId = restaurant.id;
      event.restaurantName = restaurant.name;
      event.restaurantAddress = restaurant.address;
      event.restaurantLat = restaurant.lat;
      event.restaurantLng = restaurant.lng;
    }

    if (dto.title !== undefined) event.title = dto.title;
    if ('description' in dto) event.description = dto.description ?? null;
    if ('additionalInfo' in dto) event.additionalInfo = dto.additionalInfo ?? null;
    if ('facebookShareText' in dto) event.facebookShareText = dto.facebookShareText ?? null;
    if (dto.isSecret !== undefined) event.isSecret = dto.isSecret;
    if (dto.eventDate !== undefined) event.eventDate = dto.eventDate;
    if (dto.eventTime !== undefined) event.eventTime = dto.eventTime;

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

    await this.eventRepo.save(event);

    // Reload with fresh relations so the response reflects any restaurant/city change
    const saved = await this.findOne(event.id, callerRole);

    if (saved.status === EventStatus.CANCELLED && wasPublished) {
      void this.sendCancellationEmails(saved);
      void this.calendarService.invalidateAll();
    } else if (wasPublished && saved.status === EventStatus.PUBLISHED && (changedDate || changedTime || changedRestaurant)) {
      void this.sendUpdateEmails(saved);
      void this.calendarService.invalidateAll();
    } else if (!wasPublished && saved.status === EventStatus.PUBLISHED) {
      void this.sendPublishInvites(saved);
    }

    return saved;
  }

  private async sendCancellationEmails(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
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
    <img src="${appUrl}/assets/logo.png" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
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
        <span style="color:#C9933A;margin-right:8px">🍽️</span>${event.restaurantName}
      </td></tr>
    </table>
    ${reasonBlock}
    <p style="margin:20px 0 0;font-size:0.88rem;color:#888">We hope to see you at the next DinnerBears dinner!</p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    // Members who RSVPd
    const rsvps = await this.rsvpRepo.find({
      where: { eventId: event.id },
      relations: ['user'],
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
    const guestLinks = await this.guestLinkRepo.find({
      where: { eventId: event.id, cancelledAt: IsNull() },
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

  private async sendUpdateEmails(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    const buildHtml = (recipientName: string) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${appUrl}/assets/logo.png" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
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
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.restaurantName}${event.restaurantAddress ? ` — ${event.restaurantAddress}` : ''}
      </td></tr>
    </table>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View Updated Event</a>
    </p>
    <p style="margin:0;font-size:0.85rem;color:#888">If you can no longer attend, you can update your RSVP on the event page.</p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const rsvps = await this.rsvpRepo.find({
      where: { eventId: event.id },
      relations: ['user'],
    });
    for (const rsvp of rsvps) {
      if (!rsvp.user?.email) continue;
      await this.emailService.queue({
        toEmail: rsvp.user.email,
        toName: rsvp.user.fullName,
        subject: `Updated: ${event.title}`,
        htmlBody: buildHtml(rsvp.user.fullName),
      });
    }

    const guestLinks = await this.guestLinkRepo.find({
      where: { eventId: event.id, cancelledAt: IsNull() },
    });
    for (const link of guestLinks) {
      if (!link.recipientEmail) continue;
      const name = link.recipientName ?? link.recipientEmail;
      await this.emailService.queue({
        toEmail: link.recipientEmail,
        toName: name,
        subject: `Updated: ${event.title}`,
        htmlBody: buildHtml(name),
      });
    }
  }

  async remove(id: number): Promise<void> {
    const event = await this.findOne(id);
    if (event.status === EventStatus.PUBLISHED) {
      throw new BadRequestException('Cannot delete a published event — cancel it first');
    }
    await this.eventRepo.remove(event);
  }

  async upsertRsvp(
    eventId: number,
    userId: number,
    status: RsvpStatus,
    additionalGuests: number,
    guestNames?: string[],
    userRole?: UserRole,
  ): Promise<EventRsvpEntity> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
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
    if (event.eventDate < todayEastern) {
      throw new BadRequestException('Cannot RSVP to a past event');
    }

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId } });

    const isPastCutoff = isPastRsvpCutoff(event.eventDate, event.eventTime);
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

    let saved: EventRsvpEntity;
    if (existing) {
      existing.status = status;
      existing.additionalGuests = additionalGuests;
      if (guestNames !== undefined) {
        existing.guestNames = guestNames.length > 0 ? guestNames : null;
      }
      saved = await this.rsvpRepo.save(existing);
    } else {
      saved = await this.rsvpRepo.save(
        this.rsvpRepo.create({
          eventId,
          userId,
          status,
          additionalGuests,
          guestNames: guestNames && guestNames.length > 0 ? guestNames : null,
        }),
      );
    }

    this.calendarService.invalidateForUser(userId);

    // Send .ics confirmation when a member newly commits to Going
    const wasGoingBefore = existing?.status === RsvpStatus.GOING;
    if (status === RsvpStatus.GOING && !wasGoingBefore) {
      void this.sendRsvpConfirmation(event, userId);
    }

    return saved;
  }

  private async sendPublishInvites(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');

    const members = await this.userRepo
      .createQueryBuilder('u')
      .where('u.status IN (:...statuses)', { statuses: ['active', 'non_validated'] })
      .andWhere('u.email IS NOT NULL')
      .andWhere(
        `(u.calendarAutoInvite = 'all' OR (u.calendarAutoInvite = 'city' AND u.cityId = :cityId))`,
        { cityId: event.cityId },
      )
      .getMany();

    if (members.length === 0) return;

    const existingRsvps = await this.rsvpRepo.find({ where: { eventId: event.id }, select: ['userId'] });
    const rsvpedIds = new Set(existingRsvps.map((r) => r.userId));

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
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
    <img src="${appUrl}/assets/logo.png" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${member.fullName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You're invited to dinner! 🐻</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.restaurantName}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay} ET
      </td></tr>
      ${event.restaurantAddress ? `<tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.restaurantAddress}
      </td></tr>` : ''}
    </table>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#555">Open the attached calendar invite to Accept, Maybe, or Decline — your RSVP will update automatically. Or tap the button below to RSVP on the DinnerBears site.</p>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View &amp; RSVP</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

      const icsContent = this.calendarService.buildInviteAttachment(
        event,
        { name: member.fullName, email: member.email },
        appUrl,
      );

      await this.emailService.sendNow({
        toEmail: member.email,
        toName: member.fullName,
        subject: `DinnerBears dinner at ${event.restaurantName} — ${dateDisplay}`,
        htmlBody: html,
        attachments: [{ content: icsContent, name: 'dinner-invite.ics', contentType: 'text/calendar; method=REQUEST' }],
      }).catch((err: unknown) => {
        this.logger.warn(`Publish invite failed for ${member.email}: ${(err as Error)?.message}`);
      });
    }
  }

  private async sendRsvpConfirmation(event: EventEntity, userId: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.email) return;

    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
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
    <img src="${appUrl}/assets/logo.png" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${user.fullName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You're going! 🎉</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.restaurantName}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay} ET
      </td></tr>
      ${event.restaurantAddress ? `<tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.restaurantAddress}
      </td></tr>` : ''}
    </table>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#555">A calendar invite is attached — open it to add this dinner to your calendar. You can Accept, Maybe, or Decline directly from the invite.</p>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View Event</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const icsContent = this.calendarService.buildInviteAttachment(
      event,
      { name: user.fullName, email: user.email },
      appUrl,
    );

    await this.emailService.sendNow({
      toEmail: user.email,
      toName: user.fullName,
      subject: `You're going to DinnerBears at ${event.restaurantName}!`,
      htmlBody: html,
      attachments: [{ content: icsContent, name: 'dinner-invite.ics', contentType: 'text/calendar; method=REQUEST' }],
    }).catch((err: unknown) => {
      this.logger.warn(`RSVP confirmation email failed for user ${userId}: ${(err as Error)?.message}`);
    });
  }

  async removeRsvp(eventId: number, userId: number): Promise<void> {
    const rsvp = await this.rsvpRepo.findOne({ where: { eventId, userId } });
    if (rsvp) {
      await this.rsvpRepo.remove(rsvp);
      this.calendarService.invalidateForUser(userId);
    }
  }

  async getGuestLink(token: string) {
    const link = await this.guestLinkRepo.findOne({
      where: { token },
      relations: ['event', 'event.restaurant', 'event.restaurant.photos', 'createdBy'],
    });
    if (!link) throw new NotFoundException('Guest link not found');

    const event = link.event;
    const photoUrl = event.restaurant?.photos?.[0]?.filePath ?? null;

    return {
      eventTitle: event.title,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      eventStatus: event.status,
      restaurantName: event.restaurantName,
      restaurantAddress: event.restaurantAddress,
      restaurantLat: event.restaurantLat,
      restaurantLng: event.restaurantLng,
      restaurantPhotoUrl: photoUrl,
      invitedByName: link.createdBy?.fullName ?? 'DinnerBears',
      recipientName: link.recipientName,
      usedAt: link.usedAt,
      cancelledAt: link.cancelledAt,
      expiresAt: link.expiresAt,
    };
  }

  async removeGuestLink(linkId: number, userId: number): Promise<void> {
    const link = await this.guestLinkRepo.findOne({
      where: { id: linkId },
      relations: ['memberRsvp', 'memberRsvp.guestLinks'],
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

    rsvp.additionalGuests = Math.max(0, rsvp.additionalGuests - 1);
    if (rsvp.guestNames && idx >= 0 && idx < rsvp.guestNames.length) {
      rsvp.guestNames.splice(idx, 1);
      if (rsvp.guestNames.length === 0) rsvp.guestNames = null;
    }

    await this.guestLinkRepo.remove(link);
    await this.rsvpRepo.save(rsvp);
  }

  async cancelGuestRsvp(token: string): Promise<void> {
    const link = await this.guestLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');
    link.cancelledAt = new Date();
    await this.guestLinkRepo.save(link);
  }

  async useGuestLink(token: string, guestName?: string): Promise<{ message: string }> {
    const link = await this.guestLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (link.usedAt && !link.cancelledAt) throw new BadRequestException('This link has already been used');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');

    link.usedAt = new Date();
    link.cancelledAt = null;
    if (guestName?.trim()) link.recipientName = guestName.trim();
    await this.guestLinkRepo.save(link);
    return { message: 'RSVP confirmed' };
  }

  private formatEventTimeDisplay(hour: number, minute: number): string {
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  private buildGoogleCalendarUrl(event: EventEntity): string {
    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const end = `${y}${pad(m)}${pad(d)}T${pad(h + 2)}${pad(min)}00`;
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const details: string[] = [`🍽️ ${event.restaurantName}`];
    if (event.description) details.push(event.description);
    if (event.additionalInfo) details.push(event.additionalInfo);
    details.push(`View event: ${appUrl}/events/${event.id}`);
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: event.title,
      dates: `${start}/${end}`, location: event.restaurantAddress,
      details: details.join('\n\n'),
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  private buildGuestEmail(params: {
    appUrl: string;
    inviterName: string | null;
    subject: string;
    eventTitle: string;
    eventDateDisplay: string;
    eventTimeDisplay: string;
    restaurantName: string;
    restaurantAddress: string;
    restaurantLat: number | null;
    restaurantLng: number | null;
    photoUrl: string | null;
    description: string | null;
    additionalInfo: string | null;
    manageUrl: string;
    googleCalUrl: string;
    icsUrl: string;
  }): string {
    const {
      appUrl, inviterName, eventTitle, eventDateDisplay, eventTimeDisplay,
      restaurantName, restaurantAddress, restaurantLat, restaurantLng,
      photoUrl, description, additionalInfo, manageUrl, googleCalUrl, icsUrl,
    } = params;

    const logoUrl = `${appUrl}/assets/logo.png`;
    const mapsUrl = (restaurantLat && restaurantLng)
      ? `https://www.google.com/maps?q=${restaurantLat},${restaurantLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurantAddress)}`;

    const icsHost = appUrl.replace(/^https?:\/\//, '');
    const appleCalUrl = `webcal://${icsHost}${icsUrl.replace(appUrl, '')}`;

    const photoRow = photoUrl
      ? `<tr><td style="padding:0;line-height:0"><img src="${appUrl}${photoUrl}" alt="${restaurantName}" width="600" style="display:block;width:100%;max-height:260px;object-fit:cover" /></td></tr>`
      : '';

    const inviterRow = inviterName
      ? `<p style="margin:0 0 16px;font-size:1rem;color:#6B4226">🎉 <strong>${inviterName}</strong> invited you to dinner!</p>`
      : `<p style="margin:0 0 16px;font-size:1rem;color:#6B4226">🎉 You're on the guest list for a DinnerBears dinner!</p>`;

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
    <img src="${logoUrl}" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
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
        <span style="color:#C9933A;margin-right:8px">🍽️</span>${restaurantName}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${restaurantAddress}</a>
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
    <p style="margin:0 0 6px;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
    <p style="margin:0;font-size:0.72rem;color:#bbb">This link is yours — don't share it. It expires when the event starts.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  private buildIcs(event: EventEntity, descriptionSuffix?: string): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');

    const startUtc = eventTimeToUtc(event.eventDate, event.eventTime);
    const endUtc = new Date(startUtc.getTime() + EVENT_DURATION_MS);

    const lastMod = toIcsUtcString(new Date(event.updatedAt));
    const sequence = Math.floor(new Date(event.updatedAt).getTime() / 60000) % 999999;

    const descParts: string[] = [`🍽️ ${event.restaurantName}`];
    if (event.restaurantAddress) descParts.push(event.restaurantAddress);
    if (event.description) descParts.push('', event.description);
    if (event.additionalInfo) descParts.push('', event.additionalInfo);
    if (descriptionSuffix) descParts.push('', descriptionSuffix);

    const location = event.restaurantAddress
      ? `${event.restaurantName}, ${event.restaurantAddress}`
      : event.restaurantName;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DinnerBears//DinnerBears Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTART:${toIcsUtcString(startUtc)}`,
      `DTEND:${toIcsUtcString(endUtc)}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      `STATUS:${event.status === EventStatus.CANCELLED ? 'CANCELLED' : 'CONFIRMED'}`,
      foldIcsLine(`SUMMARY:${icsEscape(`DinnerBears Dinner at ${event.restaurantName}`)}`),
      foldIcsLine(`LOCATION:${icsEscape(location)}`),
      foldIcsLine(`DESCRIPTION:${icsEscape(descParts.join('\n'))}`),
      foldIcsLine(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=DinnerBears:mailto:noreply@dinnerbears.com`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  async generateIcs(id: number): Promise<string> {
    const event = await this.findOne(id);
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    return this.buildIcs(event, `View event: ${appUrl}/events/${id}`);
  }

  async generateGuestIcs(token: string): Promise<{ ics: string; eventId: number }> {
    const link = await this.guestLinkRepo.findOne({
      where: { token },
      relations: ['event'],
    });
    if (!link) throw new NotFoundException('Guest link not found');
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const manageUrl = `${appUrl}/rsvp-guest?token=${token}`;
    const ics = this.buildIcs(link.event, `Manage your RSVP: ${manageUrl}`);
    return { ics, eventId: link.event.id };
  }

  async generateGuestLink(
    eventId: number,
    userId: number,
    recipientName?: string,
    recipientEmail?: string,
  ): Promise<EventGuestLinkEntity> {
    const event = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['restaurant'],
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Event is not published');
    }

    const rsvp = await this.rsvpRepo.findOne({ where: { eventId, userId }, relations: ['user'] });
    if (!rsvp) throw new BadRequestException('You must RSVP before generating a guest link');

    const existingLinks = await this.guestLinkRepo.count({ where: { memberRsvpId: rsvp.id } });
    if (existingLinks >= rsvp.additionalGuests) {
      throw new BadRequestException(
        `You already have ${existingLinks} guest link(s) — increase your additional guests count to generate more`,
      );
    }

    const token = randomBytes(20).toString('hex');

    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const expiresAt = new Date(y, m - 1, d, h, min);

    const link = this.guestLinkRepo.create({
      eventId,
      createdById: userId,
      memberRsvpId: rsvp.id,
      deliveryType: 'shareable',
      recipientName: recipientName ?? null,
      recipientEmail: recipientEmail ?? null,
      token,
      expiresAt,
    });

    const saved = await this.guestLinkRepo.save(link);

    // Fire-and-forget — email delivery is best-effort and must not block returning the link
    if (recipientEmail) {
      const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
      const manageUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
      const icsUrl = `${appUrl}/api/v1/events/guest-ics/${saved.token}`;

      const [ey, em, ed] = event.eventDate.split('-').map(Number);
      const [eh, emin] = event.eventTime.split(':').map(Number);
      const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
      const photoUrl = event.restaurant?.photos?.[0]?.filePath ?? null;
      const inviterName = rsvp.user?.fullName ?? null;

      void this.emailService.queue({
        toEmail: recipientEmail,
        toName: recipientName ?? undefined,
        subject: `You're invited to a DinnerBears dinner!`,
        htmlBody: this.buildGuestEmail({
          appUrl,
          inviterName,
          subject: `You're invited to a DinnerBears dinner!`,
          eventTitle: event.title,
          eventDateDisplay,
          eventTimeDisplay,
          restaurantName: event.restaurantName ?? '',
          restaurantAddress: event.restaurantAddress ?? '',
          restaurantLat: event.restaurantLat ?? null,
          restaurantLng: event.restaurantLng ?? null,
          photoUrl,
          description: event.description ?? null,
          additionalInfo: event.additionalInfo ?? null,
          manageUrl,
          googleCalUrl: this.buildGoogleCalendarUrl(event),
          icsUrl,
        }),
      }).catch((err: unknown) => {
        this.logger.warn(`Failed to queue guest invite email to ${recipientEmail}: ${(err as Error)?.message}`);
      });
    }

    return saved;
  }

  async createPublicRsvp(eventId: number, name: string, email: string): Promise<void> {
    const event = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['city', 'restaurant'],
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('RSVPs are not open for this event');
    }
    const now = new Date();
    const eventStart = new Date(`${event.eventDate}T${event.eventTime}`);
    if (now >= eventStart) throw new BadRequestException('This event has already started');

    const existingMember = await this.userRepo.findOne({
      where: { email: email.trim().toLowerCase(), status: Not(UserStatus.DELETED) },
    });
    if (existingMember) throw new BadRequestException('already_a_member');

    const existing = await this.guestLinkRepo.findOne({
      where: { eventId, recipientEmail: email.toLowerCase(), source: 'public', cancelledAt: IsNull() },
    });
    if (existing) throw new BadRequestException('An RSVP for this email already exists for this event');

    const token = randomBytes(32).toString('hex');
    const link = this.guestLinkRepo.create({
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
    const saved = await this.guestLinkRepo.save(link);

    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const manageUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
    const icsUrl = `${appUrl}/api/v1/events/guest-ics/${saved.token}`;

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
    const photoUrl = event.restaurant?.photos?.[0]?.filePath ?? null;

    await this.emailService.queue({
      toEmail: email,
      toName: name,
      subject: `You're going to a DinnerBears dinner!`,
      htmlBody: this.buildGuestEmail({
        appUrl,
        inviterName: null,
        subject: `You're going to a DinnerBears dinner!`,
        eventTitle: event.title,
        eventDateDisplay,
        eventTimeDisplay,
        restaurantName: event.restaurantName ?? '',
        restaurantAddress: event.restaurantAddress ?? '',
        restaurantLat: event.restaurantLat ?? null,
        restaurantLng: event.restaurantLng ?? null,
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
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const [rsvps, guestLinks] = await Promise.all([
      this.rsvpRepo.find({
        where: { eventId, status: RsvpStatus.GOING },
        relations: ['user'],
        order: { createdAt: 'ASC' },
      }),
      this.guestLinkRepo.find({
        where: { eventId },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const members = rsvps.map((r) => ({
      type: 'member' as const,
      userId: r.userId,
      memberName: r.user?.fullName ?? 'Member',
      attended: r.attended ?? null,
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
        attended: l.attended ?? null,
        isWalkin: false,
        fromOtherCity: false,
        linkUsed: !!l.usedAt,
      }));

    return [...members, ...guests];
  }

  async markAttendance(eventId: number, attendances: { userId: number; attended: boolean; fromOtherCity?: boolean }[]): Promise<void> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    for (const entry of attendances) {
      const update: Partial<EventRsvpEntity> = { attended: entry.attended };
      if (entry.fromOtherCity !== undefined) update.fromOtherCity = entry.fromOtherCity;

      await this.rsvpRepo.update(
        { eventId, userId: entry.userId, status: RsvpStatus.GOING },
        update,
      );
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
    const link = await this.guestLinkRepo.findOne({ where: { id: guestLinkId } });
    if (!link) throw new NotFoundException('Guest link not found');
    await this.guestLinkRepo.update(guestLinkId, { attended });
  }

  async resendGuestInvite(guestLinkId: number): Promise<void> {
    const link = await this.guestLinkRepo.findOne({
      where: { id: guestLinkId },
      relations: ['event', 'event.restaurant', 'event.restaurant.photos', 'memberRsvp', 'memberRsvp.user'],
    });
    if (!link) throw new NotFoundException('Guest link not found');
    if (!link.recipientEmail) throw new BadRequestException('This guest link has no email address to resend to');

    const event = link.event;
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const manageUrl = `${appUrl}/rsvp-guest?token=${link.token}`;
    const icsUrl = `${appUrl}/api/v1/events/guest-ics/${link.token}`;

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
    const photoUrl = event.restaurant?.photos?.[0]?.filePath ?? null;
    const inviterName = link.memberRsvp?.user?.fullName ?? null;

    await this.emailService.queue({
      toEmail: link.recipientEmail,
      toName: link.recipientName ?? undefined,
      subject: `You're invited to a DinnerBears dinner!`,
      htmlBody: this.buildGuestEmail({
        appUrl,
        inviterName,
        subject: `You're invited to a DinnerBears dinner!`,
        eventTitle: event.title,
        eventDateDisplay,
        eventTimeDisplay,
        restaurantName: event.restaurantName ?? '',
        restaurantAddress: event.restaurantAddress ?? '',
        restaurantLat: event.restaurantLat ?? null,
        restaurantLng: event.restaurantLng ?? null,
        photoUrl,
        description: event.description ?? null,
        additionalInfo: event.additionalInfo ?? null,
        manageUrl,
        googleCalUrl: this.buildGoogleCalendarUrl(event),
        icsUrl,
      }),
    });
  }

  async searchMembersForWalkin(eventId: number, query: string): Promise<{ id: number; fullName: string }[]> {
    const existingRsvps = await this.rsvpRepo.find({
      where: { eventId, status: RsvpStatus.GOING },
      select: ['userId'],
    });
    const excludeIds = existingRsvps.map((r) => r.userId);

    const qb = this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.fullName'])
      .where('u.status = :status', { status: 'active' })
      .orderBy('u.full_name', 'ASC')
      .limit(20);

    if (excludeIds.length > 0) {
      qb.andWhere('u.id NOT IN (:...excludeIds)', { excludeIds });
    }

    if (query.trim()) {
      qb.andWhere('u.full_name LIKE :q', { q: `%${query.trim()}%` });
    }

    const users = await qb.getMany();
    return users.map((u) => ({ id: u.id, fullName: u.fullName }));
  }

  async getReservationInfo(token: string): Promise<{ eventTitle: string; restaurantName: string; eventDate: string; eventTime: string; inviteToken?: string }> {
    const event = await this.eventRepo.findOne({ where: { reservationConfirmToken: token } });
    if (!event) throw new NotFoundException('Confirmation link not found');
    let inviteToken: string | undefined;
    if (event.reservationContactEmail) {
      const invite = await this.inviteRepo.findOne({
        where: {
          type: InviteType.EVENT_INVITE,
          eventId: event.id,
          boundToEmail: event.reservationContactEmail.toLowerCase(),
          isRevoked: false,
          redeemedAt: IsNull(),
        },
      });
      if (invite) inviteToken = invite.token;
    }
    return {
      eventTitle: event.title,
      restaurantName: event.restaurantName,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  async setReservation(eventId: number, dto: SetReservationDto, callerUser?: UserEntity): Promise<EventEntity> {
    const event = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['restaurant', 'reservationAssignee'],
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
        const assignee = await this.userRepo.findOne({ where: { id: dto.assigneeId } });
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
        const existingInvite = await this.inviteRepo.findOne({
          where: {
            type: InviteType.EVENT_INVITE,
            eventId: event.id,
            boundToEmail: normalizedEmail,
            isRevoked: false,
            redeemedAt: IsNull(),
          },
        });
        let inviteToken: string;
        if (existingInvite) {
          inviteToken = existingInvite.token;
        } else {
          const inviteExpiry = new Date();
          inviteExpiry.setDate(inviteExpiry.getDate() + 30);
          const newInvite = await this.inviteRepo.save(this.inviteRepo.create({
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
          }));
          inviteToken = newInvite.token;
        }
        const signupUrl = `${appUrl}/login?token=${inviteToken}`;
        await this.sendReservationRequestEmail(event, dto.contactName ?? dto.contactEmail, dto.contactEmail, confirmUrl, signupUrl);
      } else {
        event.reservationConfirmToken = null;
      }
    }

    await this.eventRepo.save(event);
    return this.findOne(eventId, callerUser?.role);
  }

  private async sendReservationRequestEmail(
    event: EventEntity,
    recipientName: string,
    recipientEmail: string,
    confirmUrl: string | null,
    signupUrl?: string,
  ): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);

    const eventUrl = `${appUrl}/events/${event.id}`;
    const ctaUrl = confirmUrl ?? eventUrl;
    const ctaLabel = confirmUrl ? 'Mark Reservation as Made' : 'View Event';

    const mapsUrl = (event.restaurantLat && event.restaurantLng)
      ? `https://www.google.com/maps?q=${event.restaurantLat},${event.restaurantLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.restaurantAddress)}`;

    const phone = event.restaurant?.phone ?? null;
    const websiteUrl = event.restaurant?.websiteUrl ?? null;
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
    <img src="${appUrl}/assets/logo.png" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You've been asked to make the dinner reservation</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span><strong>${dateDisplay}</strong> at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;${phone || websiteUrl ? 'border-bottom:1px solid #e8e0d6;' : ''}font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${event.restaurantName} — ${event.restaurantAddress}</a>
      </td></tr>
      ${phoneRow}
      ${websiteRow}
    </table>
    <p style="margin:0 0 12px;font-size:0.9rem;color:#555">
      Please call <strong>${event.restaurantName}</strong> and make a reservation for about
      <strong>20&ndash;25 people</strong> to start. A few things to mention when you call:
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:0.9rem;color:#555;line-height:1.7">
      <li>DinnerBears members typically start arriving <strong>30 minutes early</strong>, so give them a heads-up.</li>
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
      <p style="margin:0 0 10px;font-size:0.88rem;color:#555;font-weight:600">New to DinnerBears?</p>
      <p style="margin:0 0 12px;font-size:0.85rem;color:#777">Create your account and you'll be auto-RSVPed to this dinner.</p>
      <a href="${signupUrl}" style="background:#1E4D8C;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;display:inline-block">Create My Account</a>
    </div>` : ''}
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
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

  async confirmReservation(token: string): Promise<{ eventTitle: string; restaurantName: string; eventDate: string; eventTime: string; inviteToken?: string }> {
    const event = await this.eventRepo.findOne({ where: { reservationConfirmToken: token } });
    if (!event) throw new NotFoundException('Confirmation link not found or already used');
    event.reservationConfirmed = true;
    event.reservationConfirmedBy = event.reservationContactName ?? 'Outside Contact';
    event.reservationConfirmedAt = new Date();
    await this.eventRepo.save(event);
    let inviteToken: string | undefined;
    if (event.reservationContactEmail) {
      const invite = await this.inviteRepo.findOne({
        where: {
          type: InviteType.EVENT_INVITE,
          eventId: event.id,
          boundToEmail: event.reservationContactEmail.toLowerCase(),
          isRevoked: false,
          redeemedAt: IsNull(),
        },
      });
      if (invite) inviteToken = invite.token;
    }
    return {
      eventTitle: event.title,
      restaurantName: event.restaurantName,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkReservationSeatsReminders(): Promise<void> {
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

    const events = await this.eventRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.restaurant', 'restaurant')
      .where('e.status = :status', { status: EventStatus.PUBLISHED })
      .andWhere('e.reservationSeatsEmailSent = 0')
      .andWhere('(e.reservationAssigneeId IS NOT NULL OR e.reservationContactEmail IS NOT NULL)')
      .andWhere('TIMESTAMP(e.event_date, e.event_time) BETWEEN :start AND :end', {
        start: easternNow,
        end: easternPlus2,
      })
      .getMany();

    for (const event of events) {
      try {
        await this.sendSeatsReminderEmail(event);
        await this.eventRepo.update(event.id, { reservationSeatsEmailSent: true });
      } catch (err) {
        this.logger.error(`Seats reminder failed for event ${event.id}`, err);
      }
    }
  }

  private async sendSeatsReminderEmail(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');

    // Resolve recipient
    let recipientEmail: string | null = event.reservationContactEmail;
    let recipientName: string = event.reservationContactName ?? 'there';
    if (event.reservationAssigneeId) {
      const assignee = await this.userRepo.findOne({ where: { id: event.reservationAssigneeId } });
      if (!assignee?.email) return;
      recipientEmail = assignee.email;
      recipientName = assignee.fullName;
    }
    if (!recipientEmail) return;

    // Current going count (member RSVPs + additional guests + public RSVPs)
    const goingRsvps = await this.rsvpRepo.find({
      where: { eventId: event.id, status: RsvpStatus.GOING },
    });
    let goingCount = goingRsvps.reduce((sum, r) => sum + 1 + r.additionalGuests, 0);
    const publicCount = await this.guestLinkRepo.count({
      where: { eventId: event.id, source: 'public', cancelledAt: IsNull() },
    });
    goingCount += publicCount;
    const suggestedCount = goingCount + 3;

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const mapsUrl = (event.restaurantLat && event.restaurantLng)
      ? `https://www.google.com/maps?q=${event.restaurantLat},${event.restaurantLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.restaurantAddress)}`;

    const rPhone = event.restaurant?.phone ?? null;
    const rWebsite = event.restaurant?.websiteUrl ?? null;
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
    <img src="${appUrl}/assets/logo.png" alt="DinnerBears" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">Updated headcount for tonight's dinner</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span><strong>${dateDisplay}</strong> at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${event.restaurantName} — ${event.restaurantAddress}</a>
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
      The event starts in about 2 hours. Please call <strong>${event.restaurantName}</strong> now and update the reservation
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
    <p style="margin:0;font-size:0.78rem;color:#999">DinnerBears — Good food. Great company. Bear memories.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await this.emailService.queue({
      toEmail: recipientEmail,
      toName: recipientName,
      subject: `Headcount update for ${event.title} — please call ${event.restaurantName}`,
      htmlBody: html,
    });
  }

  async addWalkin(eventId: number, userId: number): Promise<{ type: 'member'; userId: number; memberName: string; attended: boolean | null; isWalkin: boolean; fromOtherCity: boolean; linkUsed: boolean }> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Member not found');

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId } });
    if (existing) {
      existing.attended = true;
      existing.isWalkin = true;
      await this.rsvpRepo.save(existing);
    } else {
      const rsvp = this.rsvpRepo.create({
        eventId,
        userId,
        status: RsvpStatus.GOING,
        attended: true,
        isWalkin: true,
        additionalGuests: 0,
      });
      await this.rsvpRepo.save(rsvp);
    }

    await this.pointsService.awardAttendance(userId, eventId).catch(() => {});
    await this.achievementsService.checkEventAchievement(userId, eventId).catch(() => {});

    return { type: 'member' as const, userId, memberName: user.fullName, attended: true, isWalkin: true, fromOtherCity: false, linkUsed: false };
  }
}
