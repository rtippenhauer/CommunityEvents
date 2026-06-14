import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RestaurantRatingEntity } from '../../database/entities/restaurant-rating.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { RestaurantsService } from './restaurants.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

export interface RatingAggregate {
  count: number;
  avgFood: number | null;
  avgService: number | null;
  avgValue: number | null;
  avgNoise: number | null;
  avgOverall: number | null;
}

export interface ReviewItem {
  id: number;
  memberName: string;
  memberPhoto: string | null;
  eventDate: string;
  food: number;
  service: number;
  valueRating: number;
  noise: number;
  comment: string | null;
  createdAt: Date;
}

export interface EligibleEvent {
  id: number;
  title: string;
  eventDate: string;
  alreadyRated: boolean;
}

export interface RatingsResponse {
  aggregate: RatingAggregate;
  reviews: ReviewItem[];
  eligibleEvents: EligibleEvent[];
}

export interface RatingQueueItem {
  restaurantId: number;
  restaurantName: string;
  restaurantPhotoUrl: string | null;
  eventId: number;
  eventDate: string;
  alreadyRated: boolean;
}

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(RestaurantRatingEntity)
    private readonly ratingRepo: Repository<RestaurantRatingEntity>,
    @InjectRepository(RestaurantPhotoEntity)
    private readonly photoRepo: Repository<RestaurantPhotoEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    private readonly restaurantsService: RestaurantsService,
  ) {}

  async getRatings(restaurantId: number, currentUser?: UserEntity): Promise<RatingsResponse> {
    await this.restaurantsService.findOne(restaurantId); // 404 if not found

    const aggregate = await this.ratingRepo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(r.food)', 'avgFood')
      .addSelect('AVG(r.service)', 'avgService')
      .addSelect('AVG(r.value_rating)', 'avgValue')
      .addSelect('AVG(r.noise)', 'avgNoise')
      .addSelect('AVG((r.food + r.service + r.value_rating + r.noise) / 4)', 'avgOverall')
      .where('r.restaurant_id = :restaurantId', { restaurantId })
      .getRawOne<{
        count: string;
        avgFood: string | null;
        avgService: string | null;
        avgValue: string | null;
        avgNoise: string | null;
        avgOverall: string | null;
      }>();

    const reviews = await this.ratingRepo
      .createQueryBuilder('r')
      .innerJoin('r.member', 'm')
      .innerJoin('r.event', 'e')
      .select([
        'r.id',
        'r.food',
        'r.service',
        'r.value_rating',
        'r.noise',
        'r.comment',
        'r.created_at',
        'm.fullName',
        'm.profilePhotoPath',
        'e.eventDate',
      ])
      .where('r.restaurant_id = :restaurantId', { restaurantId })
      .orderBy('r.created_at', 'DESC')
      .limit(20)
      .getRawMany<{
        r_id: number;
        r_food: number;
        r_service: number;
        r_value_rating: number;
        r_noise: number;
        r_comment: string | null;
        r_created_at: Date;
        m_full_name: string;
        m_profile_photo_path: string | null;
        e_event_date: string;
      }>();

    const eligibleEvents: EligibleEvent[] = [];
    if (currentUser && currentUser.role !== UserRole.NON_VALIDATED) {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const goingRsvps = await this.rsvpRepo
        .createQueryBuilder('rsvp')
        .innerJoin('rsvp.event', 'e')
        .select(['rsvp.eventId', 'e.title', 'e.eventDate'])
        .where('rsvp.userId = :userId', { userId: currentUser.id })
        .andWhere('rsvp.status = :status', { status: RsvpStatus.GOING })
        .andWhere('e.restaurantId = :restaurantId', { restaurantId })
        .andWhere('e.eventDate < :today', { today: todayStr })
        .getRawMany<{ rsvp_event_id: number; e_title: string; e_event_date: string }>();

      const myRatingEventIds = new Set(
        (await this.ratingRepo.find({
          select: ['eventId'],
          where: { memberId: currentUser.id, restaurantId },
        })).map((r) => r.eventId),
      );

      for (const row of goingRsvps) {
        eligibleEvents.push({
          id: row.rsvp_event_id,
          title: row.e_title,
          eventDate: row.e_event_date,
          alreadyRated: myRatingEventIds.has(row.rsvp_event_id),
        });
      }
    }

    return {
      aggregate: {
        count: parseInt(aggregate?.count ?? '0', 10),
        avgFood: aggregate?.avgFood != null ? parseFloat(aggregate.avgFood) : null,
        avgService: aggregate?.avgService != null ? parseFloat(aggregate.avgService) : null,
        avgValue: aggregate?.avgValue != null ? parseFloat(aggregate.avgValue) : null,
        avgNoise: aggregate?.avgNoise != null ? parseFloat(aggregate.avgNoise) : null,
        avgOverall: aggregate?.avgOverall != null ? parseFloat(aggregate.avgOverall) : null,
      },
      reviews: reviews.map((row) => ({
        id: row.r_id,
        memberName: row.m_full_name,
        memberPhoto: row.m_profile_photo_path,
        eventDate: row.e_event_date,
        food: row.r_food,
        service: row.r_service,
        valueRating: row.r_value_rating,
        noise: row.r_noise,
        comment: row.r_comment,
        createdAt: row.r_created_at,
      })),
      eligibleEvents,
    };
  }

  async submitRating(restaurantId: number, user: UserEntity, dto: CreateRatingDto): Promise<RestaurantRatingEntity> {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Ratings require a validated account');
    }

    const event = await this.eventRepo.findOne({ where: { id: dto.eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.restaurantId !== restaurantId) {
      throw new BadRequestException('Event was not held at this restaurant');
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (event.eventDate >= todayStr) {
      throw new BadRequestException('Can only rate past events');
    }

    const rsvp = await this.rsvpRepo.findOne({
      where: { eventId: dto.eventId, userId: user.id, status: RsvpStatus.GOING },
    });
    if (!rsvp) {
      throw new ForbiddenException('You must have attended this event (Going RSVP) to submit a rating');
    }

    const existing = await this.ratingRepo.findOne({
      where: { memberId: user.id, eventId: dto.eventId },
    });

    const rating = existing ?? this.ratingRepo.create({ memberId: user.id, eventId: dto.eventId, restaurantId });
    rating.food = dto.food;
    rating.service = dto.service;
    rating.valueRating = dto.valueRating;
    rating.noise = dto.noise;
    rating.comment = dto.comment ?? null;

    return this.ratingRepo.save(rating);
  }

  async getRatingQueue(userId: number): Promise<RatingQueueItem[]> {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const rows = await this.rsvpRepo
      .createQueryBuilder('rsvp')
      .innerJoin('rsvp.event', 'e')
      .leftJoin(RestaurantRatingEntity, 'rating', 'rating.memberId = :userId AND rating.eventId = e.id', { userId })
      .select('e.restaurantId', 'restaurantId')
      .addSelect('e.restaurantName', 'restaurantName')
      .addSelect('e.id', 'eventId')
      .addSelect('e.eventDate', 'eventDate')
      .addSelect('rating.id', 'ratingId')
      .where('rsvp.userId = :userId', { userId })
      .andWhere('rsvp.status = :status', { status: RsvpStatus.GOING })
      .andWhere('e.eventDate < :today', { today: todayStr })
      .andWhere('e.restaurantId IS NOT NULL')
      .orderBy('e.eventDate', 'DESC')
      .getRawMany<{
        restaurantId: number;
        restaurantName: string | null;
        eventId: number;
        eventDate: string;
        ratingId: number | null;
      }>();

    if (rows.length === 0) return [];

    const restaurantIds = [...new Set(rows.map((r) => Number(r.restaurantId)))];
    const photoRows = await this.photoRepo.find({
      where: { restaurantId: In(restaurantIds) },
      order: { restaurantId: 'ASC', sortOrder: 'ASC' },
    });
    const photoMap = new Map<number, string>();
    for (const p of photoRows) {
      if (!photoMap.has(p.restaurantId)) photoMap.set(p.restaurantId, p.filePath);
    }

    return rows.map((r) => ({
      restaurantId: Number(r.restaurantId),
      restaurantName: r.restaurantName ?? 'Unknown Restaurant',
      restaurantPhotoUrl: photoMap.get(Number(r.restaurantId)) ?? null,
      eventId: Number(r.eventId),
      eventDate: r.eventDate,
      alreadyRated: r.ratingId !== null,
    }));
  }
}
