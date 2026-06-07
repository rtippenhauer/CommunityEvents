import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
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
      relations: ['city', 'restaurant', 'restaurant.photos', 'createdByUser'],
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

    if (event.status === EventStatus.CANCELLED) {
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
}
