import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { EventGuestLinkEntity } from '../../database/entities/event-guest-link.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

export interface EventFilters {
  cityId?: number;
  upcoming?: boolean;
  status?: EventStatus;
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
    } else {
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

  async upsertRsvp(
    eventId: number,
    userId: number,
    additionalGuests: number,
    guestNames?: string[],
  ): Promise<EventRsvpEntity> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Can only RSVP to published events');
    }

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId } });
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
      expiresAt: link.expiresAt,
    };
  }

  async useGuestLink(token: string, guestName?: string): Promise<{ message: string }> {
    const link = await this.guestLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (link.usedAt) throw new BadRequestException('This link has already been used');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');

    link.usedAt = new Date();
    if (guestName?.trim()) link.recipientName = guestName.trim();
    await this.guestLinkRepo.save(link);
    return { message: 'RSVP confirmed' };
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

    return this.guestLinkRepo.save(link);
  }
}
