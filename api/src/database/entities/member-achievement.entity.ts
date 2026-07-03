import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Column } from 'typeorm';
import { UserEntity } from './user.entity';
import { AchievementEntity } from './achievement.entity';

@Entity('member_achievements')
export class MemberAchievementEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'member_id', unsigned: true })
  memberId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: UserEntity;

  @Column({ name: 'achievement_id', unsigned: true })
  achievementId: number;

  @ManyToOne(() => AchievementEntity, (a) => a.memberAchievements, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'achievement_id' })
  achievement: AchievementEntity;

  @CreateDateColumn({ name: 'earned_at' })
  earnedAt: Date;

  @Column({ name: 'seen_at', type: 'datetime', nullable: true })
  seenAt: Date | null;
}
