import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { location_ratings as LocationRating, users as User } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RsvpStatus, UserRole } from '../../database/enums';
import { toDateString, toTimeString } from '../../common/utils/prisma-date.util';
import { LocationsService } from './locations.service';
import { PointsService } from '../community/points.service';
import { AppConfigService } from '../app-config/app-config.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { coerceRawRows } from '../../common/utils/prisma-raw.util';

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
    private readonly prisma: PrismaService,
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

  async getRatings(locationId: number, currentUser?: User): Promise<RatingsResponse> {
    const location = await this.locationsService.findOne(locationId); // 404 if not found
    // When residence ratings are suppressed, a residence keeps any existing
    // reviews visible but offers no new ones — clear the eligible-events list.
    const suppressForResidence = location.isResidence && (await this.residenceRatingsSuppressed());

    // avgOverall averages a per-row expression, which Prisma's aggregate API
    // cannot express -- it would have to be recomputed in Node from the other
    // four averages, and the average of averages is not the same number once
    // any component is NULL. Kept as SQL for that reason.
    const [aggregate] = await this.prisma.$queryRaw<
      {
        count: bigint | number;
        avgFood: string | null;
        avgService: string | null;
        avgValue: string | null;
        avgNoise: string | null;
        avgOverall: string | null;
      }[]
    >`
      SELECT COUNT(*) AS count,
             AVG(r.food) AS avgFood,
             AVG(r.service) AS avgService,
             AVG(r.value_rating) AS avgValue,
             AVG(r.noise) AS avgNoise,
             AVG((r.food + r.service + r.value_rating + r.noise) / 4) AS avgOverall
      FROM location_ratings r
      WHERE r.location_id = ${locationId}`;

    // DATE_FORMAT keeps eventDate a 'YYYY-MM-DD' string in the response, which
    // is what it has always been on the wire. Letting Prisma return the DATE
    // column as a Date would serialise it as a full ISO timestamp instead.
    const reviews = await this.prisma.$queryRaw<
      {
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
      }[]
    >`
      SELECT r.id AS id,
             r.food AS food,
             r.service AS service,
             r.value_rating AS valueRating,
             r.noise AS noise,
             r.comment AS comment,
             r.created_at AS createdAt,
             m.id AS memberId,
             m.full_name AS memberName,
             m.profile_photo_path AS memberPhoto,
             DATE_FORMAT(e.event_date, '%Y-%m-%d') AS eventDate
      FROM location_ratings r
      INNER JOIN users m ON m.id = r.member_id
      INNER JOIN events e ON e.id = r.event_id
      WHERE r.location_id = ${locationId}
      ORDER BY r.created_at DESC
      LIMIT 20`;

    const eligibleEvents: EligibleEvent[] = [];
    if (!suppressForResidence && currentUser && currentUser.role !== UserRole.NON_VALIDATED) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

      const goingRsvps = await this.prisma.$queryRaw<
        { eventId: number; title: string; eventDate: string }[]
      >`
        SELECT rsvp.event_id AS eventId,
               e.title AS title,
               DATE_FORMAT(e.event_date, '%Y-%m-%d') AS eventDate
        FROM event_rsvps rsvp
        INNER JOIN events e ON e.id = rsvp.event_id
        WHERE rsvp.user_id = ${currentUser.id}
          AND rsvp.status = ${RsvpStatus.GOING}
          AND e.location_id = ${locationId}
          AND (e.event_date < ${todayStr}
               OR (e.event_date = ${todayStr} AND e.event_time <= ${nowTimeStr}))`;

      const myRatingEventIds = new Set(
        (
          await this.prisma.location_ratings.findMany({
            select: { eventId: true },
            where: { memberId: currentUser.id, locationId },
          })
        ).map((r) => r.eventId),
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
        // COUNT(*) comes back from a raw query as a BigInt under Prisma
        // where the driver previously produced a string, so Number() replaces
        // the parseInt. BigInt would also fail to JSON.stringify if it reached
        // the response untouched.
        count: Number(aggregate?.count ?? 0),
        avgFood: aggregate?.avgFood != null ? parseFloat(aggregate.avgFood) : null,
        avgService: aggregate?.avgService != null ? parseFloat(aggregate.avgService) : null,
        avgValue: aggregate?.avgValue != null ? parseFloat(aggregate.avgValue) : null,
        avgNoise: aggregate?.avgNoise != null ? parseFloat(aggregate.avgNoise) : null,
        avgOverall: aggregate?.avgOverall != null ? parseFloat(aggregate.avgOverall) : null,
      },
      // id/food/service/valueRating/noise are integer columns, and a raw query
      // hands those back as BigInt — which JSON.stringify refuses to serialise.
      // The scattered Number() calls elsewhere in this file were covering the
      // same hazard one column at a time.
      reviews: coerceRawRows(reviews).map((row) => ({
        id: row.id,
        memberId: row.memberId,
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

  async submitRating(locationId: number, user: User, dto: CreateRatingDto): Promise<LocationRating> {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Ratings require a validated account');
    }

    const event = await this.prisma.events.findUnique({ where: { id: dto.eventId } });
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
    // event_date/event_time are DATE/TIME columns the entity typed as strings.
    // Prisma returns Dates, so they are formatted back before comparing --
    // comparing a Date against a 'YYYY-MM-DD' string would coerce through the
    // Date's full ISO form and misjudge whether the event has happened, which
    // decides whether a member is allowed to rate it at all.
    const eventDateStr = toDateString(event.eventDate);
    const eventTimeStr = event.eventTime ? toTimeString(event.eventTime) : '23:59:59';
    const eventIsPast =
      eventDateStr < todayStr || (eventDateStr === todayStr && eventTimeStr <= nowTimeStr);
    if (!eventIsPast) {
      throw new BadRequestException('Can only rate past events');
    }

    const rsvp = await this.prisma.event_rsvps.findFirst({
      where: { eventId: dto.eventId, userId: user.id, status: RsvpStatus.GOING },
    });
    if (!rsvp) {
      throw new ForbiddenException('You must have attended this event to submit a rating');
    }
    if (rsvp.attended === false) {
      throw new ForbiddenException('You must have attended this event to submit a rating');
    }

    const existing = await this.prisma.location_ratings.findFirst({
      where: { memberId: user.id, eventId: dto.eventId },
    });

    const isNew = !existing;
    const scores = {
      food: dto.food,
      service: dto.service,
      valueRating: dto.valueRating,
      noise: dto.noise,
      comment: dto.comment ?? null,
    };

    const saved = existing
      ? await this.prisma.location_ratings.update({ where: { id: existing.id }, data: scores })
      : await this.prisma.location_ratings.create({
          data: { memberId: user.id, eventId: dto.eventId, locationId, ...scores },
        });
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

    // Two correlated subqueries (the fallback location name and the cover
    // photo) plus a conditional join, so this stays SQL. The residence filter
    // is appended the same way the query builder appended it.
    const residenceFilter = excludeResidences ? 'AND (loc.id IS NULL OR loc.is_residence = 0)' : '';

    const rows = await this.prisma.$queryRawUnsafe<
      {
        locationId: number;
        locationName: string | null;
        eventId: number;
        eventDate: string;
        ratingId: number | null;
        photoUrl: string | null;
      }[]
    >(
      `SELECT
         e.location_id AS locationId,
         COALESCE(NULLIF(e.location_name, ''),
                  (SELECT res.name FROM locations res WHERE res.id = e.location_id LIMIT 1))
           AS locationName,
         e.id AS eventId,
         DATE_FORMAT(e.event_date, '%Y-%m-%d') AS eventDate,
         rating.id AS ratingId,
         (SELECT p.file_path FROM location_photos p
           WHERE p.location_id = e.location_id
           ORDER BY p.sort_order ASC LIMIT 1) AS photoUrl
       FROM event_rsvps rsvp
       INNER JOIN events e ON e.id = rsvp.event_id
       LEFT JOIN locations loc ON loc.id = e.location_id
       LEFT JOIN location_ratings rating
         ON rating.member_id = ? AND rating.event_id = e.id
       WHERE rsvp.user_id = ?
         AND rsvp.status = ?
         AND (rsvp.attended = 1 OR rsvp.attended IS NULL)
         AND (e.event_date < ? OR (e.event_date = ? AND e.event_time <= ?))
         AND e.location_id IS NOT NULL
         ${residenceFilter}
       ORDER BY e.event_date DESC`,
      userId,
      userId,
      RsvpStatus.GOING,
      todayStr,
      todayStr,
      nowTimeStr,
    );


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
