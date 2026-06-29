import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AchievementEntity } from '../../database/entities/achievement.entity';
import { MemberAchievementEntity } from '../../database/entities/member-achievement.entity';
import { MemberPointEntity, PointType } from '../../database/entities/member-point.entity';

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
    if (count >= 1) await this.grant(userId, 'first_dinner');
    if (count >= 5) await this.grant(userId, 'regular');
    if (count >= 25) await this.grant(userId, 'veteran');
  }

  async checkCoordinatorAchievements(userId: number): Promise<void> {
    const totalCoord = await this.pointRepo.count({
      where: [
        { userId, pointType: PointType.COORDINATOR },
        { userId, pointType: PointType.COORDINATOR_NEW_RESTAURANT },
      ],
    });
    if (totalCoord >= 1) await this.grant(userId, 'first_coordinator');

    const newRestaurantCount = await this.pointRepo.count({
      where: { userId, pointType: PointType.COORDINATOR_NEW_RESTAURANT },
    });
    if (newRestaurantCount >= 3) await this.grant(userId, 'scout');
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

  async getMemberAchievements(userId: number): Promise<MemberAchievementEntity[]> {
    return this.memberAchievementRepo.find({
      where: { memberId: userId },
      order: { earnedAt: 'ASC' },
    });
  }

  async getAllAchievements(): Promise<AchievementEntity[]> {
    return this.achievementRepo.find({ order: { id: 'ASC' } });
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
