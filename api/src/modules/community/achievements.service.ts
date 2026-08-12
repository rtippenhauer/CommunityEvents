import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { $Enums } from '@prisma/client';
import type { Prisma, achievements as Achievement } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PointType, ProgressType } from '../../database/enums';
import { coerceRawRows } from '../../common/utils/prisma-raw.util';

// Declaration order of the progress_type ENUM, which is the order MySQL sorts
// it in. Read from the generated client rather than hand-listed so it tracks
// the schema automatically.
const PROGRESS_TYPE_ORDER: string[] = Object.values($Enums.achievements_progress_type);

// Independence Day week — the qualifying window for the Patriotic Bear achievement.
// Starts a day earlier on stage so it can be tested without waiting for July 4.
const PATRIOTIC_BEAR_START_PROD = new Date('2026-07-04T00:00:00');
const PATRIOTIC_BEAR_START_STAGE = new Date('2026-07-03T00:00:00');
const PATRIOTIC_BEAR_END = new Date('2026-07-11T23:59:59.999');

// member_achievements rows with their achievement attached -- the shape the
// entity produced automatically via `eager: true`, now stated explicitly.
export type MemberAchievementWithAchievement = Prisma.member_achievementsGetPayload<{
  include: { achievement: true };
}>;

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
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.patrioticBearStart = configService.get<string>('IS_STAGE') === 'true'
      ? PATRIOTIC_BEAR_START_STAGE
      : PATRIOTIC_BEAR_START_PROD;
  }

  async hasEarned(userId: number, key: string): Promise<boolean> {
    const achievement = await this.prisma.achievements.findUnique({ where: { key } });
    if (!achievement) return false;
    const earned = await this.prisma.member_achievements.findFirst({
      where: { memberId: userId, achievementId: achievement.id },
    });
    return !!earned;
  }

  private async grant(userId: number, key: string): Promise<void> {
    const achievement = await this.prisma.achievements.findUnique({ where: { key } });
    if (!achievement) return;
    const exists = await this.prisma.member_achievements.findFirst({
      where: { memberId: userId, achievementId: achievement.id },
    });
    if (exists) return;
    await this.prisma.member_achievements.create({
      data: { memberId: userId, achievementId: achievement.id },
    });
    if (achievement.points > 0) {
      await this.prisma.member_points.create({
        data: {
          userId,
          pointType: PointType.ACHIEVEMENT,
          referenceId: achievement.id,
          points: achievement.points,
        },
      });
    }
  }

  async checkAttendanceAchievements(userId: number): Promise<void> {
    const count = await this.prisma.member_points.count({
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
    // Both coordinator flavours count toward the same achievements, so the
    // array-of-where OR becomes an `in` rather than two separate counts.
    const totalCoord = await this.prisma.member_points.count({
      where: {
        userId,
        pointType: { in: [PointType.COORDINATOR, PointType.NEW_LOCATION_COORDINATOR] },
      },
    });
    if (totalCoord >= 1)   await this.grant(userId, 'first_coordinator');
    if (totalCoord >= 5)   await this.grant(userId, 'gracious_host');
    if (totalCoord >= 10)  await this.grant(userId, 'maitre_d');
    if (totalCoord >= 25)  await this.grant(userId, 'banquet_captain');
    if (totalCoord >= 50)  await this.grant(userId, 'grand_maestro');
    if (totalCoord >= 100) await this.grant(userId, 'legendary_maestro');

    const newLocationCount = await this.prisma.member_points.count({
      where: { userId, pointType: PointType.NEW_LOCATION_COORDINATOR },
    });
    if (newLocationCount >= 1)   await this.grant(userId, 'scout');
    if (newLocationCount >= 5)   await this.grant(userId, 'culinary_explorer');
    if (newLocationCount >= 10)  await this.grant(userId, 'trailblazer');
    if (newLocationCount >= 25)  await this.grant(userId, 'culinary_pioneer');
    if (newLocationCount >= 50)  await this.grant(userId, 'master_explorer');
    if (newLocationCount >= 100) await this.grant(userId, 'legendary_scout');
  }

  async checkRatingAchievements(userId: number): Promise<void> {
    const count = await this.prisma.member_points.count({
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
    const count = await this.prisma.member_points.count({
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
    const count = await this.prisma.member_points.count({
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
    const count = await this.prisma.member_points.count({
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

  private readonly secretDinnerTiers = [
    { key: 'secret_dinner_1', threshold: 1 },
    { key: 'secret_dinner_3', threshold: 3 },
    { key: 'secret_dinner_5', threshold: 5 },
    { key: 'secret_dinner_10', threshold: 10 },
    { key: 'secret_dinner_25', threshold: 25 },
    { key: 'secret_dinner_50', threshold: 50 },
    { key: 'secret_dinner_100', threshold: 100 },
  ];

  private async revoke(userId: number, key: string): Promise<void> {
    const achievement = await this.prisma.achievements.findUnique({ where: { key } });
    if (!achievement) return;
    await this.prisma.member_achievements.deleteMany({
      where: { memberId: userId, achievementId: achievement.id },
    });
    await this.prisma.member_points.deleteMany({
      where: { userId, pointType: PointType.ACHIEVEMENT, referenceId: achievement.id },
    });
  }

  // Mirror image of checkSecretDinnerAchievements: called after an event's
  // secret-dinner points are retracted (e.g. admin unmarks the event as
  // secret), so a member's badge/points never outlive the count they were
  // earned from.
  async recheckSecretDinnerAchievements(userId: number): Promise<void> {
    const count = await this.prisma.member_points.count({
      where: { userId, pointType: PointType.SECRET_DINNER },
    });
    for (const tier of this.secretDinnerTiers) {
      if (count < tier.threshold) await this.revoke(userId, tier.key);
    }
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
    const achievement = await this.prisma.achievements.findFirst({
      where: { eventId, progressType: ProgressType.EVENT },
    });
    if (!achievement) return;
    await this.grant(userId, achievement.key);
  }

  async getAchievementsWithProgress(userId: number): Promise<AchievementWithProgress[]> {
    const [all, earned, user] = await Promise.all([
      this.prisma.achievements.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.member_achievements.findMany({
        where: { memberId: userId },
        orderBy: { earnedAt: 'asc' },
      }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    // Count points by type for progress
    const pointCounts = await this.prisma.member_points.groupBy({
      by: ['pointType'],
      where: { userId },
      _count: { _all: true },
    });
    const countMap: Record<string, number> = {};
    for (const r of pointCounts) {
      countMap[r.pointType] = r._count._all;
    }
    const attendanceCount = countMap['attendance'] ?? 0;
    const coordinatorCount = (countMap['coordinator'] ?? 0) + (countMap['new_location_coordinator'] ?? 0);
    const newLocationCount = countMap['new_location_coordinator'] ?? 0;
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
          case ProgressType.NEW_LOCATION_COORDINATOR: progressCurrent = newLocationCount; break;
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
          progressType: a.progressType as ProgressType | null,
          progressTarget: a.progressTarget,
          progressCurrent,
          eventId: a.eventId,
          isSecret: a.isSecret,
          earned: !!ma,
          earnedAt: ma ? ma.earnedAt.toISOString() : null,
        };
      });
  }

  async getUnseenAchievements(userId: number): Promise<MemberAchievementWithAchievement[]> {
    // Same eager-relation caveat as getEarnedTitles: the controller renders
    // ma.achievement.*, which TypeORM attached automatically.
    return this.prisma.member_achievements.findMany({
      where: { memberId: userId, seenAt: null },
      include: { achievement: true },
      orderBy: { earnedAt: 'asc' },
    });
  }

  async markAchievementSeen(userId: number, memberAchievementId: number): Promise<void> {
    // updateMany: memberId is an ownership check, so one member cannot mark
    // another member's achievement as seen.
    await this.prisma.member_achievements.updateMany({
      where: { id: memberAchievementId, memberId: userId },
      data: { seenAt: new Date() },
    });
  }

  async getMemberAchievements(userId: number): Promise<MemberAchievementWithAchievement[]> {
    return this.prisma.member_achievements.findMany({
      where: { memberId: userId },
      include: { achievement: true },
      orderBy: { earnedAt: 'asc' },
    });
  }

  async getAllAchievements(): Promise<Achievement[]> {
    return this.prisma.achievements.findMany({ orderBy: { id: 'asc' } });
  }

  async getEventAchievement(eventId: number): Promise<Achievement | null> {
    return this.prisma.achievements.findFirst({ where: { eventId } });
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
  }): Promise<Achievement> {
    const key = `event_${dto.eventId}_${Date.now()}`;
    return this.prisma.achievements.create({
      data: {
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
      },
    });
  }

  // Called right after a "Special Dinner Achievement" is created (or an
  // existing one is un-deleted by creating a new one), so members who were
  // already marked attended before the achievement existed still get it —
  // scoped to this one event's attendees, not a global sweep.
  async grantEventAchievementToAttendees(eventId: number): Promise<{ attendeesChecked: number }> {
    const attendees = await this.prisma.event_rsvps.findMany({
      where: { eventId, attended: true },
      select: { userId: true },
    });
    for (const { userId } of attendees) {
      await this.checkEventAchievement(userId, eventId);
    }
    return { attendeesChecked: attendees.length };
  }

  // Removes a per-event "Special Dinner Achievement" entirely, including
  // clawing back the badge and points from anyone who already earned it —
  // there's no partial/soft-delete state for these, they're one-off and
  // event-scoped so a full removal is always what "delete" means here.
  async deleteEventAchievement(eventId: number): Promise<{ removedAchievements: number; removedPoints: number }> {
    const achievement = await this.prisma.achievements.findFirst({
      where: { eventId, progressType: ProgressType.EVENT },
    });
    if (!achievement) throw new NotFoundException('This event has no achievement to remove');

    // One transaction: clawing back the badge, its points and the achievement
    // itself has to be all-or-nothing, or a failure part-way leaves members
    // holding points for an achievement that no longer exists.
    const [removedPoints, removedAchievements] = await this.prisma.$transaction([
      this.prisma.member_points.deleteMany({
        where: { pointType: PointType.ACHIEVEMENT, referenceId: achievement.id },
      }),
      this.prisma.member_achievements.deleteMany({ where: { achievementId: achievement.id } }),
      this.prisma.achievements.delete({ where: { id: achievement.id } }),
    ]);

    return {
      removedAchievements: removedAchievements.count,
      removedPoints: removedPoints.count,
    };
  }

  async updateEventAchievement(
    id: number,
    dto: { name: string; description: string; title?: string | null; points: number; isSecret: boolean },
  ): Promise<void> {
    await this.prisma.achievements.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        title: dto.title ?? null,
        points: dto.points,
        isSecret: dto.isSecret,
      },
    });
  }

  async updateAchievementImage(achievementId: number, imagePath: string): Promise<void> {
    await this.prisma.achievements.update({ where: { id: achievementId }, data: { imagePath } });
  }

  async getEarnedTitles(userId: number): Promise<string[]> {
    // The entity marked this relation `eager: true`, so TypeORM attached the
    // achievement to every member_achievements row automatically. Prisma has
    // no eager loading -- without this include, ma.achievement is undefined
    // and every member silently ends up with no earned titles.
    const earned = await this.prisma.member_achievements.findMany({
      where: { memberId: userId },
      include: { achievement: true },
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
    await this.prisma.users.update({ where: { id: userId }, data: { selectedTitle: title } });
  }

  async adminGrantAchievement(userId: number, key: string): Promise<void> {
    await this.grant(userId, key);
  }

  async adminRevokeAchievement(userId: number, achievementId: number): Promise<void> {
    await this.prisma.member_achievements.deleteMany({ where: { memberId: userId, achievementId } });
  }

  async adminListAchievements(): Promise<(Achievement & { earnedCount: number })[]> {
    // loadRelationCountAndMap becomes Prisma's _count, flattened onto the row
    // so the response keeps its `earnedCount` key.
    //
    // The ordering is applied here rather than in SQL: it sorts by
    // ISNULL(progressType), progressType, ISNULL(progressTarget),
    // progressTarget, id, and Prisma cannot express the ISNULL terms. This is
    // a fixed catalogue of a few dozen rows, so sorting in memory is cheap.
    //
    // progress_type is a MySQL ENUM, and MySQL orders enums by their
    // DECLARATION order, not alphabetically -- 'coordinator' (declared 2nd)
    // sorts before 'city_hopper' (7th). Comparing the strings instead would
    // reorder the admin list. PROGRESS_TYPE_ORDER below is taken from Prisma's
    // generated enum, whose member order mirrors the column definition, so the
    // two cannot drift apart.
    const rows = await this.prisma.achievements.findMany({
      include: { _count: { select: { memberAchievements: true } } },
    });

    const nullsLast = (v: unknown): number => (v === null || v === undefined ? 1 : 0);
    const enumRank = (v: string | null): number =>
      v === null ? -1 : PROGRESS_TYPE_ORDER.indexOf(v);
    const numeric = (a: number | null, b: number | null): number =>
      a === null || b === null ? 0 : a - b;

    return rows
      .sort(
        (a, b) =>
          nullsLast(a.progressType) - nullsLast(b.progressType) ||
          enumRank(a.progressType) - enumRank(b.progressType) ||
          nullsLast(a.progressTarget) - nullsLast(b.progressTarget) ||
          numeric(a.progressTarget, b.progressTarget) ||
          a.id - b.id,
      )
      .map(({ _count, ...rest }) => ({ ...rest, earnedCount: _count.memberAchievements }));
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
  }): Promise<Achievement> {
    const existing = await this.prisma.achievements.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException(`Key '${dto.key}' already exists`);
    return this.prisma.achievements.create({ data: ({
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
    }) });
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
    const update: Prisma.achievementsUncheckedUpdateInput = {
      name: dto.name,
      description: dto.description,
      icon: dto.icon,
      points: dto.points,
      title: dto.title ?? null,
      isSecret: dto.isSecret,
    };
    if (dto.progressTarget !== undefined) update.progressTarget = dto.progressTarget ?? null;
    await this.prisma.achievements.update({ where: { id }, data: update });
  }

  // member_points snapshots each achievement's point value at the moment it's
  // granted (see grant() above). If an admin later edits an achievement's
  // points via adminFullUpdate, every already-earned member_points row keeps
  // the old value, so totals drift out of sync with the achievement's current
  // worth. This re-syncs every achievement-sourced row to the current value,
  // and backfills rows for earned achievements that had 0 points at grant
  // time but have since been given a point value.
  async adminRecalculatePoints(): Promise<{ updated: number; inserted: number }> {
    const updateResult = await this.prisma.$executeRawUnsafe(`
      UPDATE member_points mp
      JOIN achievements a ON a.id = mp.reference_id
      SET mp.points = a.points
      WHERE mp.point_type = 'achievement' AND mp.points <> a.points
    `);
    // INSERT IGNORE: uq_member_points_user_type_ref (see
    // 1752100000000-AddUniqueConstraintMemberPoints) is now the real
    // backstop against duplicating a row here -- the NOT EXISTS below is
    // just the fast path that avoids hitting it on every normal run.
    const insertResult = await this.prisma.$executeRawUnsafe(`
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
    // $executeRawUnsafe returns the affected-row count directly, where the
    // TypeORM driver handed back a ResultSetHeader.
    return { updated: updateResult, inserted: insertResult };
  }

  async adminBackfillFounders(): Promise<{ granted: number }> {
    const result = await this.prisma.$executeRawUnsafe(`
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
    return { granted: result };
  }

  // One-time correction for a bug (fixed alongside this method, Phase 20) where
  // PointsService.checkInvitePointForInviter destructured the wrong raw-query
  // key and never actually found an inviter — every successful-invite Bear
  // Point and Connector-tier achievement since Phase 15 launched silently
  // failed to award. Re-derives the same condition the (now-fixed) live trigger
  // checks: an invitee who has attended at least once, whose inviter hasn't
  // already been credited for that specific invitee.
  async adminBackfillInvitePoints(): Promise<{ pointsGranted: number; achievementsGranted: number }> {
    const candidates = await this.prisma.$queryRawUnsafe<{ inviterId: number }[]>(`
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

    const insertResult = await this.prisma.$executeRawUnsafe(`
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
    for (const { inviterId } of coerceRawRows(candidates)) {
      const before = new Set(
        (
          await this.prisma.member_achievements.findMany({ where: { memberId: inviterId } })
        ).map((ma) => ma.achievementId),
      );
      await this.checkInviteAchievements(inviterId);
      const after = await this.prisma.member_achievements.findMany({
        where: { memberId: inviterId },
      });
      const newlyEarned = after.filter((ma) => !before.has(ma.achievementId));
      for (const ma of newlyEarned) {
        await this.prisma.member_achievements.update({
          where: { id: ma.id },
          data: { seenAt: new Date() },
        });
        achievementsGranted += 1;
      }
    }

    return {
      pointsGranted: insertResult,
      achievementsGranted,
    };
  }
}
