import { Injectable } from '@nestjs/common';
import type { member_points as MemberPoint } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PointType, UserRole, UserStatus } from '../../database/enums';
import { AchievementsService } from './achievements.service';
import { coerceRawRows } from '../../common/utils/prisma-raw.util';

export type SecretDinnerResync = { enabled: true; awarded: number } | { enabled: false; removed: number };

export interface PointSummary {
  total: number;
  byType: Record<PointType, number>;
}

export interface PointLedgerEntry {
  date: Date;
  achievement: string;
  points: number;
}

export interface PointLedgerDetailed {
  entries: PointLedgerEntry[];
  total: number;
}

const POINT_TYPE_LABELS: Record<Exclude<PointType, typeof PointType.ACHIEVEMENT>, string> = {
  [PointType.ATTENDANCE]: 'Attended a dinner',
  [PointType.COORDINATOR]: 'Coordinated a dinner',
  [PointType.NEW_LOCATION_COORDINATOR]: 'Coordinated a dinner at a new restaurant',
  [PointType.INVITE]: 'Invited a member who attended their first dinner',
  [PointType.RATING]: 'Rated a restaurant',
  [PointType.CITY_HOPPER]: 'Dined in a new city',
  [PointType.SECRET_DINNER]: 'Attended a secret dinner',
};

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  fullName: string;
  profilePhotoPath: string | null;
  selectedTitle: string | null;
  totalPoints: number;
  topType: PointType | null;
  cityId: number;
  cityName: string;
  isNew: boolean;
}

@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievementsService: AchievementsService,
  ) {}

  async awardAttendance(userId: number, eventId: number): Promise<void> {
    const exists = await this.prisma.member_points.findFirst({
      where: { userId, pointType: PointType.ATTENDANCE, referenceId: eventId },
    });
    if (exists) return;

    await this.prisma.member_points.create({ data: { userId, pointType: PointType.ATTENDANCE, referenceId: eventId, points: 1 } });

    await this.achievementsService.checkAttendanceAchievements(userId);
    await this.checkInvitePointForInviter(userId);
  }

  async awardCoordinator(userId: number, eventId: number): Promise<void> {
    // Either coordinator flavour already counts as awarded, so the
    // array-of-where OR becomes an `in` over the two point types.
    const exists = await this.prisma.member_points.findFirst({
      where: {
        userId,
        referenceId: eventId,
        pointType: { in: [PointType.COORDINATOR, PointType.NEW_LOCATION_COORDINATOR] },
      },
    });
    if (exists) return;

    const event = await this.prisma.events.findUnique({
      where: { id: eventId },
      include: { location: true },
    });
    if (!event) return;

    // Scout credit: location was added to DinnerBears within the last week —
    // meaning the coordinator suggested this new place and added it themselves.
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const locationAge = event.location?.createdAt
      ? Date.now() - new Date(event.location.createdAt).getTime()
      : Infinity;
    const isNewLocation = locationAge < ONE_WEEK_MS;
    const pointType = isNewLocation ? PointType.NEW_LOCATION_COORDINATOR : PointType.COORDINATOR;
    const points = isNewLocation ? 4 : 2;

    await this.prisma.member_points.create({ data: { userId, pointType, referenceId: eventId, points } });

    await this.achievementsService.checkCoordinatorAchievements(userId);
  }

  async awardRating(userId: number, locationId: number): Promise<void> {
    const exists = await this.prisma.member_points.findFirst({
      where: { userId, pointType: PointType.RATING, referenceId: locationId },
    });
    if (exists) return;

    await this.prisma.member_points.create({ data: { userId, pointType: PointType.RATING, referenceId: locationId, points: 1 } });

    await this.achievementsService.checkRatingAchievements(userId);
  }

  private async checkInvitePointForInviter(attendeeId: number): Promise<void> {
    // Only fire on first attended dinner
    const priorAttended = await this.prisma.member_points.count({
      where: { userId: attendeeId, pointType: PointType.ATTENDANCE },
    });
    if (priorAttended !== 1) return; // not their first

    // Walk invite lineage to find inviter
    const attendee = await this.prisma.users.findUnique({
      where: { id: attendeeId },
      select: { id: true, invitedBy: true },
    });

    const inviterId = attendee?.invitedBy ?? null;
    if (!inviterId) return;

    const alreadyAwarded = await this.prisma.member_points.findFirst({
      where: { userId: inviterId, pointType: PointType.INVITE, referenceId: attendeeId },
    });
    if (alreadyAwarded) return;

    await this.prisma.member_points.create({ data: { userId: inviterId, pointType: PointType.INVITE, referenceId: attendeeId, points: 1 } });

    await this.achievementsService.checkInviteAchievements(inviterId);
  }

  async getSummary(userId: number): Promise<PointSummary> {
    const rows = await this.prisma.member_points.groupBy({
      by: ['pointType'],
      where: { userId },
      _sum: { points: true },
    });

    const byType = {} as Record<PointType, number>;
    let grandTotal = 0;
    for (const r of rows) {
      const total = r._sum.points ?? 0;
      byType[r.pointType as PointType] = total;
      grandTotal += total;
    }
    return { total: grandTotal, byType };
  }

  async getLeaderboard(cityId?: number): Promise<LeaderboardEntry[]> {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Grouped aggregate with a join and a computed isNew flag. Prisma's
    // groupBy cannot join, so rebuilding this would mean fetching every active
    // member and their point rows and summing in Node -- on the leaderboard,
    // which is the one endpoint where that cost is most visible.
    const cityFilter = cityId ? 'AND u.city_id = ?' : '';
    const params: unknown[] = [twoWeeksAgo, UserStatus.ACTIVE, UserRole.ADMIN, UserRole.AUTOMATION];
    if (cityId) params.push(cityId);

    const rows = await this.prisma.$queryRawUnsafe<
      {
        userId: number;
        fullName: string;
        profilePhotoPath: string | null;
        selectedTitle: string | null;
        cityId: number;
        cityName: string;
        totalPoints: string | number;
        isNew: number;
      }[]
    >(
      `SELECT u.id AS userId,
              u.full_name AS fullName,
              u.profile_photo_path AS profilePhotoPath,
              u.selected_title AS selectedTitle,
              u.city_id AS cityId,
              c.name AS cityName,
              COALESCE(SUM(mp.points), 0) AS totalPoints,
              IF(u.created_at >= ?, 1, 0) AS isNew
       FROM users u
       LEFT JOIN cities c ON c.id = u.city_id
       LEFT JOIN member_points mp ON mp.user_id = u.id
       WHERE u.status = ?
         AND u.role NOT IN (?, ?)
         ${cityFilter}
       GROUP BY u.id
       ORDER BY totalPoints DESC, u.full_name ASC`,
      ...params,
    );


    // Determine top point type per user
    const userIds = coerceRawRows(rows).map((r) => r.userId);
    const topTypeMap: Record<number, PointType | null> = {};
    if (userIds.length > 0) {
      // groupBy over two columns, ordered by the summed total so the first
      // row seen per user is their highest-scoring point type.
      const topRows = await this.prisma.member_points.groupBy({
        by: ['userId', 'pointType'],
        where: { userId: { in: userIds } },
        _sum: { points: true },
        orderBy: { _sum: { points: 'desc' } },
      });

      for (const tr of topRows) {
        if (!topTypeMap[tr.userId]) topTypeMap[tr.userId] = tr.pointType as PointType;
      }
    }

    return coerceRawRows(rows).map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      fullName: r.fullName,
      profilePhotoPath: r.profilePhotoPath,
      selectedTitle: r.selectedTitle,
      totalPoints: Number(r.totalPoints),
      topType: topTypeMap[r.userId] ?? null,
      cityId: r.cityId,
      cityName: r.cityName,
      isNew: Boolean(r.isNew),
    }));
  }

  async getLedger(userId: number): Promise<MemberPoint[]> {
    return this.prisma.member_points.findMany({
      where: { userId },
      orderBy: { awardedAt: 'desc' },
    });
  }

  async getLedgerDetailed(userId: number): Promise<PointLedgerDetailed> {
    const rows = await this.getLedger(userId);

    const achievementIds = [
      ...new Set(rows.filter((r) => r.pointType === PointType.ACHIEVEMENT).map((r) => r.referenceId)),
    ];
    const achievementNames = new Map<number, string>();
    if (achievementIds.length > 0) {
      const achievements = await this.prisma.achievements.findMany({
        where: { id: { in: achievementIds } },
      });
      for (const a of achievements) achievementNames.set(a.id, a.name);
    }

    const entries: PointLedgerEntry[] = rows.map((r) => ({
      date: r.awardedAt,
      achievement:
        r.pointType === PointType.ACHIEVEMENT
          ? achievementNames.get(r.referenceId) ?? 'Achievement unlocked'
          : POINT_TYPE_LABELS[r.pointType],
      points: r.points,
    }));

    return { entries, total: rows.reduce((sum, r) => sum + r.points, 0) };
  }

  async adminAwardPoints(userId: number, pointType: PointType, points: number, referenceId: number): Promise<void> {
    await this.prisma.member_points.create({ data: { userId, pointType, points, referenceId } });
  }

  async adminRemovePoints(pointId: number): Promise<void> {
    // deleteMany, not delete: the endpoint is documented as a no-op for an id
    // that no longer exists (an admin clicking remove twice, or on a stale
    // list). TypeORM's repository.delete() returned affected: 0; Prisma's
    // delete() throws P2025 instead, which surfaced as a 500.
    await this.prisma.member_points.deleteMany({ where: { id: pointId } });
  }

  async awardCityHopper(userId: number, eventId: number): Promise<void> {
    const exists = await this.prisma.member_points.findFirst({
      where: { userId, pointType: PointType.CITY_HOPPER, referenceId: eventId },
    });
    if (exists) return;
    await this.prisma.member_points.create({ data: { userId, pointType: PointType.CITY_HOPPER, referenceId: eventId, points: 1 } });
    await this.achievementsService.checkCityHopperAchievements(userId);
  }

  async awardSecretDinner(userId: number, eventId: number): Promise<void> {
    const exists = await this.prisma.member_points.findFirst({
      where: { userId, pointType: PointType.SECRET_DINNER, referenceId: eventId },
    });
    if (exists) return;
    await this.prisma.member_points.create({ data: { userId, pointType: PointType.SECRET_DINNER, referenceId: eventId, points: 1 } });
    await this.achievementsService.checkSecretDinnerAchievements(userId);
  }

  // Called whenever an admin flips an event's is_secret flag, so already-attended
  // members aren't stuck with (or stripped of) secret-dinner credit just because
  // of when the flag happened to change relative to their attendance being marked.
  // Scoped to this one event's attendees, so cost stays flat regardless of how
  // many events exist overall.
  async resyncSecretDinnerForEvent(eventId: number, isSecret: boolean): Promise<SecretDinnerResync> {
    if (isSecret) {
      const attendees = await this.prisma.event_rsvps.findMany({
        where: { eventId, attended: true },
        select: { userId: true },
      });
      for (const { userId } of attendees) {
        await this.awardSecretDinner(userId, eventId);
      }
      return { enabled: true, awarded: attendees.length };
    }

    const rows = await this.prisma.member_points.findMany({
      where: { pointType: PointType.SECRET_DINNER, referenceId: eventId },
    });
    if (rows.length === 0) return { enabled: false, removed: 0 };
    await this.prisma.member_points.deleteMany({
      where: { pointType: PointType.SECRET_DINNER, referenceId: eventId },
    });
    for (const { userId } of rows) {
      await this.achievementsService.recheckSecretDinnerAchievements(userId);
    }
    return { enabled: false, removed: rows.length };
  }
}
