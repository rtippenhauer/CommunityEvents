import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, DataSource, IsNull } from 'typeorm';
import { AchievementEntity, ProgressType } from '../../database/entities/achievement.entity';
import { MemberAchievementEntity } from '../../database/entities/member-achievement.entity';
import { MemberPointEntity, PointType } from '../../database/entities/member-point.entity';
import { UserEntity } from '../../database/entities/user.entity';

// Independence Day week — the qualifying window for the Patriotic Bear achievement.
// Starts a day earlier on stage so it can be tested without waiting for July 4.
const PATRIOTIC_BEAR_START_PROD = new Date('2026-07-04T00:00:00');
const PATRIOTIC_BEAR_START_STAGE = new Date('2026-07-03T00:00:00');
const PATRIOTIC_BEAR_END = new Date('2026-07-11T23:59:59.999');

export interface AchievementWithProgress {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  imagePath: string | null;
  title: string | null;
  points: number;
  progressType: ProgressType | null;
  progressTarget: number | null;
  progressCurrent: number;
  eventId: number | null;
  isSecret: boolean;
  earned: boolean;
  earnedAt: string | null;
}

@Injectable()
export class AchievementsService {
  private readonly patrioticBearStart: Date;

  constructor(
    @InjectRepository(AchievementEntity)
    private readonly achievementRepo: Repository<AchievementEntity>,
    @InjectRepository(MemberAchievementEntity)
    private readonly memberAchievementRepo: Repository<MemberAchievementEntity>,
    @InjectRepository(MemberPointEntity)
    private readonly pointRepo: Repository<MemberPointEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.patrioticBearStart = configService.get<string>('IS_STAGE') === 'true'
      ? PATRIOTIC_BEAR_START_STAGE
      : PATRIOTIC_BEAR_START_PROD;
  }

  async hasEarned(userId: number, key: string): Promise<boolean> {
    const achievement = await this.achievementRepo.findOne({ where: { key } });
    if (!achievement) return false;
    const earned = await this.memberAchievementRepo.findOne({
      where: { memberId: userId, achievementId: achievement.id },
    });
    return !!earned;
  }

  private async grant(userId: number, key: string): Promise<void> {
    const achievement = await this.achievementRepo.findOne({ where: { key } });
    if (!achievement) return;
    const exists = await this.memberAchievementRepo.findOne({
      where: { memberId: userId, achievementId: achievement.id },
    });
    if (exists) return;
    await this.memberAchievementRepo.save(
      this.memberAchievementRepo.create({ memberId: userId, achievementId: achievement.id }),
    );
    if (achievement.points > 0) {
      await this.pointRepo.save(
        this.pointRepo.create({
          userId,
          pointType: PointType.ACHIEVEMENT,
          referenceId: achievement.id,
          points: achievement.points,
        }),
      );
    }
  }

  async checkAttendanceAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.ATTENDANCE },
    });
    if (count >= 1)   await this.grant(userId, 'first_dinner');
    if (count >= 5)   await this.grant(userId, 'regular');
    if (count >= 10)  await this.grant(userId, 'table_familiar');
    if (count >= 25)  await this.grant(userId, 'veteran');
    if (count >= 50)  await this.grant(userId, 'devoted_diner');
    if (count >= 100) await this.grant(userId, 'legend_of_the_table');
  }

  async checkCoordinatorAchievements(userId: number): Promise<void> {
    const totalCoord = await this.pointRepo.count({
      where: [
        { userId, pointType: PointType.COORDINATOR },
        { userId, pointType: PointType.COORDINATOR_NEW_RESTAURANT },
      ],
    });
    if (totalCoord >= 1)   await this.grant(userId, 'first_coordinator');
    if (totalCoord >= 5)   await this.grant(userId, 'gracious_host');
    if (totalCoord >= 10)  await this.grant(userId, 'maitre_d');
    if (totalCoord >= 25)  await this.grant(userId, 'banquet_captain');
    if (totalCoord >= 50)  await this.grant(userId, 'grand_maestro');
    if (totalCoord >= 100) await this.grant(userId, 'legendary_maestro');

    const newRestaurantCount = await this.pointRepo.count({
      where: { userId, pointType: PointType.COORDINATOR_NEW_RESTAURANT },
    });
    if (newRestaurantCount >= 1)   await this.grant(userId, 'scout');
    if (newRestaurantCount >= 5)   await this.grant(userId, 'culinary_explorer');
    if (newRestaurantCount >= 10)  await this.grant(userId, 'trailblazer');
    if (newRestaurantCount >= 25)  await this.grant(userId, 'culinary_pioneer');
    if (newRestaurantCount >= 50)  await this.grant(userId, 'master_explorer');
    if (newRestaurantCount >= 100) await this.grant(userId, 'legendary_scout');
  }

  async checkRatingAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.RATING },
    });
    if (count >= 1)   await this.grant(userId, 'first_review');
    if (count >= 5)   await this.grant(userId, 'critic');
    if (count >= 10)  await this.grant(userId, 'food_connoisseur');
    if (count >= 25)  await this.grant(userId, 'dining_authority');
    if (count >= 50)  await this.grant(userId, 'master_critic');
    if (count >= 100) await this.grant(userId, 'legendary_critic');
  }

  async checkInviteAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.INVITE },
    });
    if (count >= 1)   await this.grant(userId, 'connector');
    if (count >= 5)   await this.grant(userId, 'social_butterfly');
    if (count >= 10)  await this.grant(userId, 'networker');
    if (count >= 25)  await this.grant(userId, 'ambassador');
    if (count >= 50)  await this.grant(userId, 'community_builder');
    if (count >= 100) await this.grant(userId, 'legendary_connector');
  }

  async checkCityHopperAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.CITY_HOPPER },
    });
    if (count >= 1)   await this.grant(userId, 'city_hopper_1');
    if (count >= 3)   await this.grant(userId, 'city_hopper_3');
    if (count >= 5)   await this.grant(userId, 'city_hopper_5');
    if (count >= 10)  await this.grant(userId, 'city_hopper_10');
    if (count >= 25)  await this.grant(userId, 'city_hopper_25');
    if (count >= 50)  await this.grant(userId, 'city_hopper_50');
    if (count >= 100) await this.grant(userId, 'city_hopper_100');
  }

  async checkSecretDinnerAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.SECRET_DINNER },
    });
    if (count >= 1)   await this.grant(userId, 'secret_dinner_1');
    if (count >= 3)   await this.grant(userId, 'secret_dinner_3');
    if (count >= 5)   await this.grant(userId, 'secret_dinner_5');
    if (count >= 10)  await this.grant(userId, 'secret_dinner_10');
    if (count >= 25)  await this.grant(userId, 'secret_dinner_25');
    if (count >= 50)  await this.grant(userId, 'secret_dinner_50');
    if (count >= 100) await this.grant(userId, 'secret_dinner_100');
  }

  async checkLoginAchievements(userId: number, qualifyingLoginCount: number): Promise<void> {
    if (qualifyingLoginCount >= 25)  await this.grant(userId, 'login_25');
    if (qualifyingLoginCount >= 50)  await this.grant(userId, 'login_50');
    if (qualifyingLoginCount >= 100) await this.grant(userId, 'login_100');
    if (qualifyingLoginCount >= 250) await this.grant(userId, 'login_250');
    if (qualifyingLoginCount >= 500) await this.grant(userId, 'login_500');
  }

  async checkPatrioticBearAchievement(userId: number, now: Date): Promise<void> {
    if (now >= this.patrioticBearStart && now <= PATRIOTIC_BEAR_END) {
      await this.grant(userId, 'patriotic_bear');
    }
  }

  async checkEventAchievement(userId: number, eventId: number): Promise<void> {
    const achievement = await this.achievementRepo.findOne({
      where: { eventId, progressType: ProgressType.EVENT },
    });
    if (!achievement) return;
    await this.grant(userId, achievement.key);
  }

  async getAchievementsWithProgress(userId: number): Promise<AchievementWithProgress[]> {
    const [all, earned, user] = await Promise.all([
      this.achievementRepo.find({ order: { id: 'ASC' } }),
      this.memberAchievementRepo.find({ where: { memberId: userId }, order: { earnedAt: 'ASC' } }),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);

    // Count points by type for progress
    const pointCounts = await this.dataSource.query<{ point_type: string; cnt: number }[]>(
      `SELECT point_type, COUNT(*) AS cnt FROM member_points WHERE user_id = ? GROUP BY point_type`,
      [userId],
    );
    const countMap: Record<string, number> = {};
    for (const r of pointCounts) {
      countMap[r.point_type] = Number(r.cnt);
    }
    const attendanceCount = countMap['attendance'] ?? 0;
    const coordinatorCount = (countMap['coordinator'] ?? 0) + (countMap['coordinator_new_restaurant'] ?? 0);
    const newRestaurantCount = countMap['coordinator_new_restaurant'] ?? 0;
    const inviteCount = countMap['invite'] ?? 0;
    const ratingCount = countMap['rating'] ?? 0;
    const cityHopperCount = countMap['city_hopper'] ?? 0;
    const secretDinnerCount = countMap['secret_dinner'] ?? 0;

    const earnedMap = new Map(earned.map((ma) => [ma.achievementId, ma]));
    const loginCount = user?.qualifyingLoginCount ?? 0;

    return all
      // Secret achievements stay hidden until earned, then appear like any other.
      .filter((a) => !a.isSecret || earnedMap.has(a.id))
      .map((a) => {
        const ma = earnedMap.get(a.id);
        let progressCurrent = 0;
        switch (a.progressType) {
          case ProgressType.ATTENDANCE: progressCurrent = attendanceCount; break;
          case ProgressType.COORDINATOR: progressCurrent = coordinatorCount; break;
          case ProgressType.NEW_RESTAURANT_COORDINATOR: progressCurrent = newRestaurantCount; break;
          case ProgressType.INVITE: progressCurrent = inviteCount; break;
          case ProgressType.RATING: progressCurrent = ratingCount; break;
          case ProgressType.CITY_HOPPER: progressCurrent = cityHopperCount; break;
          case ProgressType.SECRET_DINNER: progressCurrent = secretDinnerCount; break;
          case ProgressType.LOGIN: progressCurrent = loginCount; break;
          case ProgressType.FOUNDING: progressCurrent = ma ? 1 : 0; break;
          case ProgressType.EVENT: progressCurrent = ma ? 1 : 0; break;
          default: progressCurrent = 0;
        }
        return {
          id: a.id,
          key: a.key,
          name: a.name,
          description: a.description,
          icon: a.icon,
          imagePath: a.imagePath,
          title: a.title,
          points: a.points,
          progressType: a.progressType,
          progressTarget: a.progressTarget,
          progressCurrent,
          eventId: a.eventId,
          isSecret: a.isSecret,
          earned: !!ma,
          earnedAt: ma ? ma.earnedAt.toISOString() : null,
        };
      });
  }

  async getUnseenAchievements(userId: number): Promise<MemberAchievementEntity[]> {
    return this.memberAchievementRepo.find({
      where: { memberId: userId, seenAt: IsNull() },
      order: { earnedAt: 'ASC' },
    });
  }

  async markAchievementSeen(userId: number, memberAchievementId: number): Promise<void> {
    await this.memberAchievementRepo.update(
      { id: memberAchievementId, memberId: userId },
      { seenAt: new Date() },
    );
  }

  async getMemberAchievements(userId: number): Promise<MemberAchievementEntity[]> {
    return this.memberAchievementRepo.find({
      where: { memberId: userId },
      order: { earnedAt: 'ASC' },
    });
  }

  async getAllAchievements(): Promise<AchievementEntity[]> {
    return this.achievementRepo.find({ order: { id: 'ASC' } });
  }

  async getEventAchievement(eventId: number): Promise<AchievementEntity | null> {
    return this.achievementRepo.findOne({ where: { eventId } });
  }

  async createEventAchievement(dto: {
    eventId: number;
    name: string;
    description: string;
    title?: string;
    points: number;
    icon?: string;
    imagePath?: string;
    isSecret?: boolean;
  }): Promise<AchievementEntity> {
    const key = `event_${dto.eventId}_${Date.now()}`;
    const achievement = this.achievementRepo.create({
      key,
      name: dto.name,
      description: dto.description,
      icon: dto.icon || 'local_activity',
      imagePath: dto.imagePath ?? null,
      progressType: ProgressType.EVENT,
      progressTarget: 1,
      eventId: dto.eventId,
      points: dto.points,
      title: dto.title ?? null,
      isSecret: dto.isSecret ?? false,
    });
    return this.achievementRepo.save(achievement);
  }

  async updateEventAchievement(
    id: number,
    dto: { name: string; description: string; title?: string | null; points: number; isSecret: boolean },
  ): Promise<void> {
    await this.achievementRepo.update(id, {
      name: dto.name,
      description: dto.description,
      title: dto.title ?? null,
      points: dto.points,
      isSecret: dto.isSecret,
    });
  }

  async updateAchievementImage(achievementId: number, imagePath: string): Promise<void> {
    await this.achievementRepo.update(achievementId, { imagePath });
  }

  async getEarnedTitles(userId: number): Promise<string[]> {
    const earned = await this.memberAchievementRepo.find({
      where: { memberId: userId },
    });
    const titles: string[] = [];
    for (const ma of earned) {
      if (ma.achievement?.title) titles.push(ma.achievement.title);
    }
    return titles;
  }

  async selectTitle(userId: number, title: string | null): Promise<void> {
    if (title !== null) {
      const titles = await this.getEarnedTitles(userId);
      if (!titles.includes(title)) {
        throw new Error('Title not earned');
      }
    }
    await this.dataSource
      .getRepository('users')
      .update(userId, { selectedTitle: title });
  }

  async adminGrantAchievement(userId: number, key: string): Promise<void> {
    await this.grant(userId, key);
  }

  async adminRevokeAchievement(userId: number, achievementId: number): Promise<void> {
    await this.memberAchievementRepo.delete({ memberId: userId, achievementId });
  }

  async adminListAchievements(): Promise<(AchievementEntity & { earnedCount: number })[]> {
    return this.achievementRepo
      .createQueryBuilder('a')
      .loadRelationCountAndMap('a.earnedCount', 'a.memberAchievements')
      .orderBy('ISNULL(a.progressType)', 'ASC')
      .addOrderBy('a.progressType', 'ASC')
      .addOrderBy('ISNULL(a.progressTarget)', 'ASC')
      .addOrderBy('a.progressTarget', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .getMany() as Promise<(AchievementEntity & { earnedCount: number })[]>;
  }

  async adminCreateAchievement(dto: {
    key: string;
    name: string;
    description: string;
    icon: string;
    progressType: ProgressType;
    progressTarget: number | null;
    points: number;
    title?: string | null;
    isSecret: boolean;
  }): Promise<AchievementEntity> {
    const existing = await this.achievementRepo.findOne({ where: { key: dto.key } });
    if (existing) throw new ConflictException(`Key '${dto.key}' already exists`);
    return this.achievementRepo.save(this.achievementRepo.create({
      key: dto.key,
      name: dto.name,
      description: dto.description,
      icon: dto.icon || 'emoji_events',
      progressType: dto.progressType,
      progressTarget: dto.progressTarget ?? null,
      eventId: null,
      points: dto.points,
      title: dto.title ?? null,
      isSecret: dto.isSecret ?? false,
      imagePath: null,
    }));
  }

  async adminFullUpdate(id: number, dto: {
    name: string;
    description: string;
    icon: string;
    points: number;
    title?: string | null;
    isSecret: boolean;
    progressTarget?: number | null;
  }): Promise<void> {
    const update: Partial<AchievementEntity> = {
      name: dto.name,
      description: dto.description,
      icon: dto.icon,
      points: dto.points,
      title: dto.title ?? null,
      isSecret: dto.isSecret,
    };
    if (dto.progressTarget !== undefined) update.progressTarget = dto.progressTarget ?? null;
    await this.achievementRepo.update(id, update);
  }

  // member_points snapshots each achievement's point value at the moment it's
  // granted (see grant() above). If an admin later edits an achievement's
  // points via adminFullUpdate, every already-earned member_points row keeps
  // the old value, so totals drift out of sync with the achievement's current
  // worth. This re-syncs every achievement-sourced row to the current value,
  // and backfills rows for earned achievements that had 0 points at grant
  // time but have since been given a point value.
  async adminRecalculatePoints(): Promise<{ updated: number; inserted: number }> {
    const updateResult = await this.dataSource.query(`
      UPDATE member_points mp
      JOIN achievements a ON a.id = mp.reference_id
      SET mp.points = a.points
      WHERE mp.point_type = 'achievement' AND mp.points <> a.points
    `);
    // INSERT IGNORE: uq_member_points_user_type_ref (see
    // 1752100000000-AddUniqueConstraintMemberPoints) is now the real
    // backstop against duplicating a row here -- the NOT EXISTS below is
    // just the fast path that avoids hitting it on every normal run.
    const insertResult = await this.dataSource.query(`
      INSERT IGNORE INTO member_points (user_id, point_type, reference_id, points, awarded_at)
      SELECT ma.member_id, 'achievement', ma.achievement_id, a.points, NOW()
      FROM member_achievements ma
      JOIN achievements a ON a.id = ma.achievement_id
      WHERE a.points > 0
        AND NOT EXISTS (
          SELECT 1 FROM member_points mp
          WHERE mp.user_id = ma.member_id
            AND mp.point_type = 'achievement'
            AND mp.reference_id = ma.achievement_id
        )
    `);
    return {
      updated: (updateResult as { affectedRows: number }).affectedRows,
      inserted: (insertResult as { affectedRows: number }).affectedRows,
    };
  }

  async adminBackfillFounders(): Promise<{ granted: number }> {
    const result = await this.dataSource.query(`
      INSERT INTO member_achievements (member_id, achievement_id, earned_at)
      SELECT u.id, a.id, NOW()
      FROM users u
      JOIN achievements a ON a.\`key\` = 'founding_bear'
      WHERE u.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM member_achievements ma
          WHERE ma.member_id = u.id AND ma.achievement_id = a.id
        )
    `);
    return { granted: (result as { affectedRows: number }).affectedRows };
  }

  // One-time correction for a bug (fixed alongside this method, Phase 20) where
  // PointsService.checkInvitePointForInviter destructured the wrong raw-query
  // key and never actually found an inviter — every successful-invite Bear
  // Point and Connector-tier achievement since Phase 15 launched silently
  // failed to award. Re-derives the same condition the (now-fixed) live trigger
  // checks: an invitee who has attended at least once, whose inviter hasn't
  // already been credited for that specific invitee.
  async adminBackfillInvitePoints(): Promise<{ pointsGranted: number; achievementsGranted: number }> {
    const candidates = await this.dataSource.query<{ inviterId: number }[]>(`
      SELECT DISTINCT invitee.invited_by AS inviterId
      FROM users invitee
      WHERE invitee.invited_by IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM member_points ap
          WHERE ap.user_id = invitee.id AND ap.point_type = 'attendance'
        )
        AND NOT EXISTS (
          SELECT 1 FROM member_points ip
          WHERE ip.user_id = invitee.invited_by
            AND ip.point_type = 'invite'
            AND ip.reference_id = invitee.id
        )
    `);

    const insertResult = await this.dataSource.query(`
      INSERT INTO member_points (user_id, point_type, reference_id, points, awarded_at)
      SELECT invitee.invited_by, 'invite', invitee.id, 1, NOW()
      FROM users invitee
      WHERE invitee.invited_by IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM member_points ap
          WHERE ap.user_id = invitee.id AND ap.point_type = 'attendance'
        )
        AND NOT EXISTS (
          SELECT 1 FROM member_points ip
          WHERE ip.user_id = invitee.invited_by
            AND ip.point_type = 'invite'
            AND ip.reference_id = invitee.id
        )
    `);

    // Re-run the invite-achievement tier check for every affected inviter, then
    // mark anything newly earned as already-seen — these are retroactive
    // credits for invites that happened up to Phase 20, not new activity, so
    // they shouldn't trigger the achievement-splash popup on next login.
    let achievementsGranted = 0;
    for (const { inviterId } of candidates) {
      const before = new Set(
        (await this.memberAchievementRepo.find({ where: { memberId: inviterId } })).map((ma) => ma.achievementId),
      );
      await this.checkInviteAchievements(inviterId);
      const after = await this.memberAchievementRepo.find({ where: { memberId: inviterId } });
      const newlyEarned = after.filter((ma) => !before.has(ma.achievementId));
      for (const ma of newlyEarned) {
        await this.memberAchievementRepo.update(ma.id, { seenAt: new Date() });
        achievementsGranted += 1;
      }
    }

    return {
      pointsGranted: (insertResult as { affectedRows: number }).affectedRows,
      achievementsGranted,
    };
  }
}
