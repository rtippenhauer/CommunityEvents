import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { MemberPointEntity, PointType } from '../../database/entities/member-point.entity';
import { EventRsvpEntity, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { InviteEntity } from '../../database/entities/invite.entity';
import { UserRole } from '../../database/entities/user.entity';
import { AchievementsService } from './achievements.service';

export interface PointSummary {
  total: number;
  byType: Record<PointType, number>;
}

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
    @InjectRepository(MemberPointEntity)
    private readonly pointRepo: Repository<MemberPointEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(InviteEntity)
    private readonly inviteRepo: Repository<InviteEntity>,
    private readonly achievementsService: AchievementsService,
    private readonly dataSource: DataSource,
  ) {}

  async awardAttendance(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.ATTENDANCE, referenceId: eventId },
    });
    if (exists) return;

    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.ATTENDANCE, referenceId: eventId, points: 1 }),
    );

    await this.achievementsService.checkAttendanceAchievements(userId);
    await this.checkInvitePointForInviter(userId, eventId);
  }

  async awardCoordinator(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: [
        { userId, pointType: PointType.COORDINATOR, referenceId: eventId },
        { userId, pointType: PointType.COORDINATOR_NEW_RESTAURANT, referenceId: eventId },
      ],
    });
    if (exists) return;

    const event = await this.eventRepo.findOne({ where: { id: eventId }, relations: ['restaurant'] });
    if (!event) return;

    // Scout credit: restaurant was added to DinnerBears within the last week —
    // meaning the coordinator suggested this new place and added it themselves.
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const restaurantAge = event.restaurant?.createdAt
      ? Date.now() - new Date(event.restaurant.createdAt).getTime()
      : Infinity;
    const isNewRestaurant = restaurantAge < ONE_WEEK_MS;
    const pointType = isNewRestaurant ? PointType.COORDINATOR_NEW_RESTAURANT : PointType.COORDINATOR;
    const points = isNewRestaurant ? 4 : 2;

    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType, referenceId: eventId, points }),
    );

    await this.achievementsService.checkCoordinatorAchievements(userId);
  }

  async awardRating(userId: number, restaurantId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.RATING, referenceId: restaurantId },
    });
    if (exists) return;

    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.RATING, referenceId: restaurantId, points: 1 }),
    );

    await this.achievementsService.checkRatingAchievements(userId);
  }

  private async checkInvitePointForInviter(attendeeId: number, eventId: number): Promise<void> {
    // Only fire on first attended dinner
    const priorAttended = await this.pointRepo.count({
      where: { userId: attendeeId, pointType: PointType.ATTENDANCE },
    });
    if (priorAttended !== 1) return; // not their first

    // Walk invite lineage to find inviter
    const attendee = await this.dataSource
      .getRepository('users')
      .createQueryBuilder('u')
      .select(['u.id', 'u.invited_by'])
      .where('u.id = :id', { id: attendeeId })
      .getRawOne<{ u_id: number; u_invited_by: number | null }>();

    const inviterId = attendee?.u_invited_by ?? null;
    if (!inviterId) return;

    const alreadyAwarded = await this.pointRepo.findOne({
      where: { userId: inviterId, pointType: PointType.INVITE, referenceId: attendeeId },
    });
    if (alreadyAwarded) return;

    await this.pointRepo.save(
      this.pointRepo.create({ userId: inviterId, pointType: PointType.INVITE, referenceId: attendeeId, points: 1 }),
    );

    await this.achievementsService.checkInviteAchievements(inviterId);
  }

  async getSummary(userId: number): Promise<PointSummary> {
    const rows = await this.pointRepo
      .createQueryBuilder('mp')
      .select('mp.point_type', 'type')
      .addSelect('SUM(mp.points)', 'total')
      .where('mp.user_id = :uid', { uid: userId })
      .groupBy('mp.point_type')
      .getRawMany<{ type: PointType; total: string }>();

    const byType = {} as Record<PointType, number>;
    let grandTotal = 0;
    for (const r of rows) {
      byType[r.type] = Number(r.total);
      grandTotal += Number(r.total);
    }
    return { total: grandTotal, byType };
  }

  async getLeaderboard(cityId?: number): Promise<LeaderboardEntry[]> {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const qb = this.dataSource
      .createQueryBuilder()
      .select('u.id', 'userId')
      .addSelect('u.full_name', 'fullName')
      .addSelect('u.profile_photo_path', 'profilePhotoPath')
      .addSelect('u.selected_title', 'selectedTitle')
      .addSelect('u.city_id', 'cityId')
      .addSelect('c.name', 'cityName')
      .addSelect('COALESCE(SUM(mp.points), 0)', 'totalPoints')
      .addSelect(`IF(u.created_at >= :twa, 1, 0)`, 'isNew')
      .from('users', 'u')
      .leftJoin('cities', 'c', 'c.id = u.city_id')
      .leftJoin('member_points', 'mp', 'mp.user_id = u.id')
      .where('u.status = :status', { status: 'active' })
      .andWhere('u.role NOT IN (:...excludedRoles)', { excludedRoles: ['admin', UserRole.AUTOMATION] })
      .setParameter('twa', twoWeeksAgo)
      .groupBy('u.id')
      .orderBy('totalPoints', 'DESC')
      .addOrderBy('u.full_name', 'ASC');

    if (cityId) {
      qb.andWhere('u.city_id = :cityId', { cityId });
    }

    const rows = await qb.getRawMany<{
      userId: number;
      fullName: string;
      profilePhotoPath: string | null;
      selectedTitle: string | null;
      cityId: number;
      cityName: string;
      totalPoints: string;
      isNew: number;
    }>();

    // Determine top point type per user
    const userIds = rows.map((r) => r.userId);
    let topTypeMap: Record<number, PointType | null> = {};
    if (userIds.length > 0) {
      const topRows = await this.dataSource
        .createQueryBuilder()
        .select('mp.user_id', 'userId')
        .addSelect('mp.point_type', 'pointType')
        .addSelect('SUM(mp.points)', 'pts')
        .from('member_points', 'mp')
        .where('mp.user_id IN (:...ids)', { ids: userIds })
        .groupBy('mp.user_id, mp.point_type')
        .orderBy('pts', 'DESC')
        .getRawMany<{ userId: number; pointType: PointType; pts: string }>();

      for (const tr of topRows) {
        if (!topTypeMap[tr.userId]) topTypeMap[tr.userId] = tr.pointType;
      }
    }

    return rows.map((r, i) => ({
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

  async getLedger(userId: number): Promise<MemberPointEntity[]> {
    return this.pointRepo.find({
      where: { userId },
      order: { awardedAt: 'DESC' },
    });
  }

  async adminAwardPoints(userId: number, pointType: PointType, points: number, referenceId?: number): Promise<void> {
    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType, points, referenceId: referenceId ?? null }),
    );
  }

  async adminRemovePoints(pointId: number): Promise<void> {
    await this.pointRepo.delete(pointId);
  }

  async awardCityHopper(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.CITY_HOPPER, referenceId: eventId },
    });
    if (exists) return;
    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.CITY_HOPPER, referenceId: eventId, points: 1 }),
    );
    await this.achievementsService.checkCityHopperAchievements(userId);
  }

  async awardSecretDinner(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.SECRET_DINNER, referenceId: eventId },
    });
    if (exists) return;
    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.SECRET_DINNER, referenceId: eventId, points: 1 }),
    );
    await this.achievementsService.checkSecretDinnerAchievements(userId);
  }
}
