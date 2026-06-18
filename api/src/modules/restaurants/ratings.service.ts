import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RestaurantRatingEntity } from '../../database/entities/restaurant-rating.entity';
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
      .select('r.id', 'id')
      .addSelect('r.food', 'food')
      .addSelect('r.service', 'service')
      .addSelect('r.value_rating', 'valueRating')
      .addSelect('r.noise', 'noise')
      .addSelect('r.comment', 'comment')
      .addSelect('r.created_at', 'createdAt')
      .addSelect('m.id', 'memberId')
      .addSelect('m.fullName', 'memberName')
      .addSelect('m.profilePhotoPath', 'memberPhoto')
      .addSelect("DATE_FORMAT(e.event_date, '%Y-%m-%d')", 'eventDate')
      .where('r.restaurant_id = :restaurantId', { restaurantId })
      .orderBy('r.created_at', 'DESC')
      .limit(20)
      .getRawMany<{
        id: number;
        food: number;
        service: number;
        valueRating: number;
        noise: number;
        comment: string | null;
        createdAt: Date;
        memberId: number;
        memberName: string;
        memberPhoto: string | null;
        eventDate: string;
      }>();

    const eligibleEvents: EligibleEvent[] = [];
    if (currentUser && currentUser.role !== UserRole.NON_VALIDATED) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

      const goingRsvps = await this.rsvpRepo
        .createQueryBuilder('rsvp')
        .innerJoin('rsvp.event', 'e')
        .select('rsvp.eventId', 'eventId')
        .addSelect('e.title', 'title')
        .addSelect("DATE_FORMAT(e.event_date, '%Y-%m-%d')", 'eventDate')
        .where('rsvp.userId = :userId', { userId: currentUser.id })
        .andWhere('rsvp.status = :status', { status: RsvpStatus.GOING })
        .andWhere('e.restaurantId = :restaurantId', { restaurantId })
        .andWhere('(e.eventDate < :today OR (e.eventDate = :today AND e.eventTime <= :nowTime))', { today: todayStr, nowTime: nowTimeStr })
        .getRawMany<{ eventId: number; title: string; eventDate: string }>();

      const myRatingEventIds = new Set(
        (await this.ratingRepo.find({
          select: ['eventId'],
          where: { memberId: currentUser.id, restaurantId },
        })).map((r) => r.eventId),
      );

      for (const row of goingRsvps) {
        eligibleEvents.push({
          id: Number(row.eventId),
          title: row.title,
          eventDate: row.eventDate,
          alreadyRated: myRatingEventIds.has(Number(row.eventId)),
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
        id: row.id,
        memberId: Number(row.memberId),
        memberName: row.memberName,
        memberPhoto: row.memberPhoto,
        eventDate: row.eventDate,
        food: row.food,
        service: row.service,
        valueRating: row.valueRating,
        noise: row.noise,
        comment: row.comment,
        createdAt: row.createdAt,
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

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    const eventIsPast =
      event.eventDate < todayStr ||
      (event.eventDate === todayStr && (event.eventTime ?? '23:59:59') <= nowTimeStr);
    if (!eventIsPast) {
      throw new BadRequestException('Can only rate past events');
    }

    const rsvp = await this.rsvpRepo.findOne({
      where: { eventId: dto.eventId, userId: user.id, status: RsvpStatus.GOING },
    });
    if (!rsvp) {
      throw new ForbiddenException('You must have attended this event to submit a rating');
    }
    if (rsvp.attended === false) {
      throw new ForbiddenException('You must have attended this event to submit a rating');
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
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

    const rows = await this.rsvpRepo
      .createQueryBuilder('rsvp')
      .innerJoin('rsvp.event', 'e')
      .leftJoin(RestaurantRatingEntity, 'rating', 'rating.memberId = :userId AND rating.eventId = e.id', { userId })
      .select('e.restaurantId', 'restaurantId')
      .addSelect(
        `COALESCE(NULLIF(e.restaurant_name, ''), (SELECT res.name FROM restaurants res WHERE res.id = e.restaurant_id LIMIT 1))`,
        'restaurantName',
      )
      .addSelect('e.id', 'eventId')
      .addSelect("DATE_FORMAT(e.event_date, '%Y-%m-%d')", 'eventDate')
      .addSelect('rating.id', 'ratingId')
      .addSelect(
        '(SELECT p.file_path FROM restaurant_photos p WHERE p.restaurant_id = e.restaurant_id ORDER BY p.sort_order ASC LIMIT 1)',
        'photoUrl',
      )
      .where('rsvp.userId = :userId', { userId })
      .andWhere('rsvp.status = :status', { status: RsvpStatus.GOING })
      .andWhere('(rsvp.attended = 1 OR rsvp.attended IS NULL)')
      .andWhere('(e.eventDate < :today OR (e.eventDate = :today AND e.eventTime <= :nowTime))', { today: todayStr, nowTime: nowTimeStr })
      .andWhere('e.restaurantId IS NOT NULL')
      .orderBy('e.eventDate', 'DESC')
      .getRawMany<{
        restaurantId: number;
        restaurantName: string | null;
        eventId: number;
        eventDate: string;
        ratingId: number | null;
        photoUrl: string | null;
      }>();

    return rows.map((row) => ({
      restaurantId: Number(row.restaurantId),
      restaurantName: row.restaurantName ?? 'Unknown Restaurant',
      restaurantPhotoUrl: row.photoUrl ?? null,
      eventId: Number(row.eventId),
      eventDate: row.eventDate,
      alreadyRated: row.ratingId !== null,
    }));
  }
}
