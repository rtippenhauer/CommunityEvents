import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AchievementEntity, ProgressType } from '../../database/entities/achievement.entity';
import { MemberAchievementEntity } from '../../database/entities/member-achievement.entity';
import { MemberPointEntity, PointType } from '../../database/entities/member-point.entity';

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
  constructor(
    @InjectRepository(AchievementEntity)
    private readonly achievementRepo: Repository<AchievementEntity>,
    @InjectRepository(MemberAchievementEntity)
    private readonly memberAchievementRepo: Repository<MemberAchievementEntity>,
    @InjectRepository(MemberPointEntity)
    private readonly pointRepo: Repository<MemberPointEntity>,
    private readonly dataSource: DataSource,
  ) {}

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
    if (totalCoord >= 1)  await this.grant(userId, 'first_coordinator');
    if (totalCoord >= 5)  await this.grant(userId, 'gracious_host');
    if (totalCoord >= 10) await this.grant(userId, 'maitre_d');
    if (totalCoord >= 25) await this.grant(userId, 'banquet_captain');
    if (totalCoord >= 50) await this.grant(userId, 'grand_maestro');

    const newRestaurantCount = await this.pointRepo.count({
      where: { userId, pointType: PointType.COORDINATOR_NEW_RESTAURANT },
    });
    if (newRestaurantCount >= 3)  await this.grant(userId, 'scout');
    if (newRestaurantCount >= 8)  await this.grant(userId, 'culinary_explorer');
    if (newRestaurantCount >= 20) await this.grant(userId, 'trailblazer');
  }

  async checkRatingAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.RATING },
    });
    if (count >= 5) await this.grant(userId, 'critic');
  }

  async checkInviteAchievements(userId: number): Promise<void> {
    const count = await this.pointRepo.count({
      where: { userId, pointType: PointType.INVITE },
    });
    if (count >= 1) await this.grant(userId, 'connector');
  }

  async checkEventAchievement(userId: number, eventId: number): Promise<void> {
    const achievement = await this.achievementRepo.findOne({
      where: { eventId, progressType: ProgressType.EVENT },
    });
    if (!achievement) return;
    await this.grant(userId, achievement.key);
    // Award points if the achievement has points configured
    if (achievement.points > 0) {
      await this.pointRepo.save(
        this.pointRepo.create({
          userId,
          pointType: PointType.ATTENDANCE,
          referenceId: eventId,
          points: achievement.points,
        }),
      );
    }
  }

  async getAchievementsWithProgress(userId: number): Promise<AchievementWithProgress[]> {
    const [all, earned] = await Promise.all([
      this.achievementRepo.find({ order: { id: 'ASC' } }),
      this.memberAchievementRepo.find({ where: { memberId: userId }, order: { earnedAt: 'ASC' } }),
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

    const earnedMap = new Map(earned.map((ma) => [ma.achievementId, ma]));

    return all
      .filter((a) => !a.isSecret)
      .map((a) => {
        const ma = earnedMap.get(a.id);
        let progressCurrent = 0;
        switch (a.progressType) {
          case ProgressType.ATTENDANCE: progressCurrent = attendanceCount; break;
          case ProgressType.COORDINATOR: progressCurrent = coordinatorCount; break;
          case ProgressType.NEW_RESTAURANT_COORDINATOR: progressCurrent = newRestaurantCount; break;
          case ProgressType.INVITE: progressCurrent = inviteCount; break;
          case ProgressType.RATING: progressCurrent = ratingCount; break;
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
    imagePath?: string;
  }): Promise<AchievementEntity> {
    const key = `event_${dto.eventId}_${Date.now()}`;
    const achievement = this.achievementRepo.create({
      key,
      name: dto.name,
      description: dto.description,
      icon: 'local_activity',
      imagePath: dto.imagePath ?? null,
      progressType: ProgressType.EVENT,
      progressTarget: 1,
      eventId: dto.eventId,
      points: dto.points,
      title: dto.title ?? null,
      isSecret: false,
    });
    return this.achievementRepo.save(achievement);
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
}
