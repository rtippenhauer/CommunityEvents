import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { UserRole } from '../../database/entities/user.entity';
import { EventGuestLinkEntity } from '../../database/entities/event-guest-link.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/email.constants';
import { ConfigService } from '@nestjs/config';

export interface EventFilters {
  cityId?: number;
  upcoming?: boolean;
  status?: EventStatus;
  isAdminOrMod?: boolean;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    @InjectRepository(EventGuestLinkEntity)
    private readonly guestLinkRepo: Repository<EventGuestLinkEntity>,
    @InjectRepository(RestaurantEntity)
    private readonly restaurantRepo: Repository<RestaurantEntity>,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async findAll(filters: EventFilters): Promise<EventEntity[]> {
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

    const today = new Date().toISOString().split('T')[0];
    if (filters.upcoming === true) {
      qb.andWhere('e.eventDate >= :today', { today }).orderBy('e.eventDate', 'ASC');
    } else if (filters.upcoming === false) {
      qb.andWhere('e.eventDate < :today', { today }).orderBy('e.eventDate', 'DESC');
    } else {
      qb.orderBy('e.eventDate', 'DESC');
    }

    return qb.getMany();
  }

  async findOne(id: number): Promise<EventEntity> {
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
      ],
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
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
      createdById: userId,
    });

    if (event.status === EventStatus.PUBLISHED) {
      event.publishedAt = new Date();
    }

    return this.eventRepo.save(event);
  }

  async update(id: number, dto: UpdateEventDto): Promise<EventEntity> {
    const event = await this.findOne(id);

    const isRestoring = event.status === EventStatus.CANCELLED && dto.status === EventStatus.DRAFT;
    if (event.status === EventStatus.CANCELLED && !isRestoring) {
      throw new BadRequestException('Cannot edit a cancelled event');
    }

    const wasPublished = event.status === EventStatus.PUBLISHED;

    if (dto.restaurantId && dto.restaurantId !== event.restaurantId) {
      const restaurant = await this.restaurantRepo.findOne({
        where: { id: dto.restaurantId },
      });
      if (!restaurant) throw new NotFoundException(`Restaurant ${dto.restaurantId} not found`);
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
    if (dto.eventDate !== undefined) event.eventDate = dto.eventDate;
    if (dto.eventTime !== undefined) event.eventTime = dto.eventTime;

    if (dto.status !== undefined && dto.status !== event.status) {
      if (dto.status === EventStatus.PUBLISHED && !wasPublished) {
        event.publishedAt = new Date();
      }
      if (dto.status === EventStatus.CANCELLED) {
        event.cancelledAt = new Date();
        event.cancelledReason = dto.cancelledReason ?? null;
      }
      event.status = dto.status;
    }

    return this.eventRepo.save(event);
  }

  async remove(id: number): Promise<void> {
    const event = await this.findOne(id);
    if (event.status === EventStatus.PUBLISHED) {
      throw new BadRequestException('Cannot delete a published event — cancel it first');
    }
    await this.eventRepo.remove(event);
  }

  private isPastRsvpCutoff(eventDate: string, eventTime: string): boolean {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
    const todayEastern = `${get('year')}-${get('month')}-${get('day')}`;
    if (todayEastern !== eventDate) return false;
    const [h, min] = eventTime.split(':').map(Number);
    const cutoffMinutes = h * 60 + min - 150; // 2.5 hrs before event
    const nowMinutes = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
    return nowMinutes >= cutoffMinutes;
  }

  async upsertRsvp(
    eventId: number,
    userId: number,
    additionalGuests: number,
    guestNames?: string[],
    userRole?: UserRole,
  ): Promise<EventRsvpEntity> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Can only RSVP to published events');
    }

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId } });

    if (!existing && this.isPastRsvpCutoff(event.eventDate, event.eventTime) &&
        userRole !== UserRole.ADMIN && userRole !== UserRole.MODERATOR) {
      throw new ForbiddenException('RSVP is closed — the deadline has passed');
    }

    if (existing) {
      existing.additionalGuests = additionalGuests;
      if (guestNames !== undefined) {
        existing.guestNames = guestNames.length > 0 ? guestNames : null;
      }
      return this.rsvpRepo.save(existing);
    }

    return this.rsvpRepo.save(
      this.rsvpRepo.create({
        eventId,
        userId,
        additionalGuests,
        guestNames: guestNames && guestNames.length > 0 ? guestNames : null,
      }),
    );
  }

  async removeRsvp(eventId: number, userId: number): Promise<void> {
    const rsvp = await this.rsvpRepo.findOne({ where: { eventId, userId } });
    if (rsvp) await this.rsvpRepo.remove(rsvp);
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
      invitedByName: link.createdBy.fullName,
      recipientName: link.recipientName,
      usedAt: link.usedAt,
      cancelledAt: link.cancelledAt,
      expiresAt: link.expiresAt,
    };
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

  async generateIcs(id: number): Promise<string> {
    const event = await this.findOne(id);

    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startDt = `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const endDt = `${y}${pad(m)}${pad(d)}T${pad(h + 2)}${pad(min)}00`;

    const esc = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DinnerBears//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `DTSTART:${startDt}`,
      `DTEND:${endDt}`,
      `SUMMARY:${esc(event.title)}`,
      `LOCATION:${esc(event.restaurantAddress)}`,
      `UID:event-${event.id}@dinnerbears.com`,
    ];

    if (event.description) {
      lines.push(`DESCRIPTION:${esc(event.description)}`);
    }

    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
  }

  async generateGuestLink(
    eventId: number,
    userId: number,
    recipientName?: string,
    recipientEmail?: string,
  ): Promise<EventGuestLinkEntity> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Event is not published');
    }

    const rsvp = await this.rsvpRepo.findOne({ where: { eventId, userId } });
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

    if (recipientEmail) {
      const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
      const guestUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
      const eventDate = new Date(`${event.eventDate}T${event.eventTime}`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      });

      await this.emailService.queue({
        toEmail: recipientEmail,
        toName: recipientName ?? undefined,
        subject: `You're invited to a DinnerBears dinner!`,
        templateId: EmailTemplate.GUEST_RSVP_CONFIRMATION,
        templateParams: {
          recipient_name: recipientName ?? recipientEmail,
          event_name: event.title,
          event_date: eventDate,
          event_time: event.eventTime,
          restaurant_name: event.restaurantName ?? '',
          guest_url: guestUrl,
        },
        htmlBody: `
          <h2>You're invited to a DinnerBears dinner!</h2>
          <p>You've been invited to join us at <strong>${event.restaurantName ?? 'dinner'}</strong> on <strong>${eventDate} at ${event.eventTime}</strong>.</p>
          <p><a href="${guestUrl}" style="background:#1e4d8c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">View Your Invitation</a></p>
          <p style="color:#888;font-size:0.85em">This link lets you RSVP and manage your attendance. It expires when the event starts.</p>
        `,
      });
    }

    return saved;
  }
}
