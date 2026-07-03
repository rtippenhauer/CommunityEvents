import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { MemberAchievementEntity } from './member-achievement.entity';

export enum ProgressType {
  ATTENDANCE = 'attendance',
  COORDINATOR = 'coordinator',
  NEW_RESTAURANT_COORDINATOR = 'new_restaurant_coordinator',
  INVITE = 'invite',
  RATING = 'rating',
  FOUNDING = 'founding',
  EVENT = 'event',
  CITY_HOPPER = 'city_hopper',
  SECRET_DINNER = 'secret_dinner',
}

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

  @Column({ length: 255, default: 'emoji_events' })
  icon: string;

  @Column({ name: 'image_path', type: 'varchar', length: 500, nullable: true })
  imagePath: string | null;

  @Column({ name: 'progress_type', type: 'enum', enum: ProgressType, nullable: true })
  progressType: ProgressType | null;

  @Column({ name: 'progress_target', type: 'int', unsigned: true, nullable: true })
  progressTarget: number | null;

  @Column({ name: 'event_id', type: 'int', unsigned: true, nullable: true })
  eventId: number | null;

  @Column({ type: 'tinyint', default: 0 })
  points: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @Column({ name: 'is_secret', type: 'tinyint', default: 0 })
  isSecret: boolean;

  @OneToMany(() => MemberAchievementEntity, (ma) => ma.achievement)
  memberAchievements: MemberAchievementEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
