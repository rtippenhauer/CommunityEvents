import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocationRatingEntity } from '../../database/entities/location-rating.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { LocationsService } from './locations.service';
import { PointsService } from '../community/points.service';
import { AppConfigService } from '../app-config/app-config.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

interface RatingAggregate {
  count: number;
  avgFood: number | null;
  avgService: number | null;
  avgValue: number | null;
  avgNoise: number | null;
  avgOverall: number | null;
}

interface ReviewItem {
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

interface EligibleEvent {
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
  locationId: number;
  locationName: string;
  locationPhotoUrl: string | null;
  eventId: number;
  eventDate: string;
  alreadyRated: boolean;
}

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(LocationRatingEntity)
    private readonly ratingRepo: Repository<LocationRatingEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    private readonly locationsService: LocationsService,
    private readonly pointsService: PointsService,
    private readonly appConfig: AppConfigService,
  ) {}

  // Residence-ratings sub-rule (Phase 33): when `feature_ratings_residences`
  // is off, a Residence location behaves as non-rateable even though the
  // overall ratings feature is on — rating someone's private home makes little
  // sense. Returns true when residence ratings are globally suppressed.
  private async residenceRatingsSuppressed(): Promise<boolean> {
    return !(await this.appConfig.isFeatureEnabled('feature_ratings_residences'));
  }

  async getRatings(locationId: number, currentUser?: UserEntity): Promise<RatingsResponse> {
    const location = await this.locationsService.findOne(locationId); // 404 if not found
    // When residence ratings are suppressed, a residence keeps any existing
    // reviews visible but offers no new ones — clear the eligible-events list.
    const suppressForResidence = location.isResidence && (await this.residenceRatingsSuppressed());

    const aggregate = await this.ratingRepo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(r.food)', 'avgFood')
      .addSelect('AVG(r.service)', 'avgService')
      .addSelect('AVG(r.value_rating)', 'avgValue')
      .addSelect('AVG(r.noise)', 'avgNoise')
      .addSelect('AVG((r.food + r.service + r.value_rating + r.noise) / 4)', 'avgOverall')
      .where('r.location_id = :locationId', { locationId })
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
      .where('r.location_id = :locationId', { locationId })
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
    if (!suppressForResidence && currentUser && currentUser.role !== UserRole.NON_VALIDATED) {
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
        .andWhere('e.locationId = :locationId', { locationId })
        .andWhere('(e.eventDate < :today OR (e.eventDate = :today AND e.eventTime <= :nowTime))', { today: todayStr, nowTime: nowTimeStr })
        .getRawMany<{ eventId: number; title: string; eventDate: string }>();

      const myRatingEventIds = new Set(
        (await this.ratingRepo.find({
          select: ['eventId'],
          where: { memberId: currentUser.id, locationId },
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

  async submitRating(locationId: number, user: UserEntity, dto: CreateRatingDto): Promise<LocationRatingEntity> {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Ratings require a validated account');
    }

    const event = await this.eventRepo.findOne({ where: { id: dto.eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.locationId !== locationId) {
      throw new BadRequestException('Event was not held at this restaurant');
    }

    const location = await this.locationsService.findOne(locationId);
    if (location.isResidence && (await this.residenceRatingsSuppressed())) {
      throw new ForbiddenException('Ratings are not available for this location');
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

    const isNew = !existing;
    const rating = existing ?? this.ratingRepo.create({ memberId: user.id, eventId: dto.eventId, locationId });
    rating.food = dto.food;
    rating.service = dto.service;
    rating.valueRating = dto.valueRating;
    rating.noise = dto.noise;
    rating.comment = dto.comment ?? null;

    const saved = await this.ratingRepo.save(rating);
    if (isNew) {
      await this.pointsService.awardRating(user.id, locationId).catch(() => {});
    }
    return saved;
  }

  async getRatingQueue(userId: number): Promise<RatingQueueItem[]> {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    const excludeResidences = await this.residenceRatingsSuppressed();

    const qb = this.rsvpRepo
      .createQueryBuilder('rsvp')
      .innerJoin('rsvp.event', 'e')
      .leftJoin('e.location', 'loc')
      .leftJoin(LocationRatingEntity, 'rating', 'rating.memberId = :userId AND rating.eventId = e.id', { userId })
      .select('e.locationId', 'locationId')
      .addSelect(
        `COALESCE(NULLIF(e.location_name, ''), (SELECT res.name FROM locations res WHERE res.id = e.location_id LIMIT 1))`,
        'locationName',
      )
      .addSelect('e.id', 'eventId')
      .addSelect("DATE_FORMAT(e.event_date, '%Y-%m-%d')", 'eventDate')
      .addSelect('rating.id', 'ratingId')
      .addSelect(
        '(SELECT p.file_path FROM location_photos p WHERE p.location_id = e.location_id ORDER BY p.sort_order ASC LIMIT 1)',
        'photoUrl',
      )
      .where('rsvp.userId = :userId', { userId })
      .andWhere('rsvp.status = :status', { status: RsvpStatus.GOING })
      .andWhere('(rsvp.attended = 1 OR rsvp.attended IS NULL)')
      .andWhere('(e.eventDate < :today OR (e.eventDate = :today AND e.eventTime <= :nowTime))', { today: todayStr, nowTime: nowTimeStr })
      .andWhere('e.locationId IS NOT NULL')
      .orderBy('e.eventDate', 'DESC');

    // Residence-ratings sub-rule: drop events held at Residence locations when
    // residence ratings are suppressed, so they never surface in the queue.
    if (excludeResidences) {
      qb.andWhere('(loc.id IS NULL OR loc.is_residence = 0)');
    }

    const rows = await qb.getRawMany<{
      locationId: number;
      locationName: string | null;
      eventId: number;
      eventDate: string;
      ratingId: number | null;
      photoUrl: string | null;
    }>();

    return rows.map((row) => ({
      locationId: Number(row.locationId),
      locationName: row.locationName ?? 'Unknown Restaurant',
      locationPhotoUrl: row.photoUrl ?? null,
      eventId: Number(row.eventId),
      eventDate: row.eventDate,
      alreadyRated: row.ratingId !== null,
    }));
  }
}
