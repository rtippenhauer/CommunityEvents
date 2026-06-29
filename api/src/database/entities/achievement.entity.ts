import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { MemberAchievementEntity } from './member-achievement.entity';

@Entity('achievements')
export class AchievementEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 64, unique: true })
  key: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 500 })
  description: string;

  @Column({ length: 80, default: 'emoji_events' })
  icon: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({ name: 'is_secret', type: 'tinyint', default: 0 })
  isSecret: boolean;

  @OneToMany(() => MemberAchievementEntity, (ma) => ma.achievement)
  memberAchievements: MemberAchievementEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
