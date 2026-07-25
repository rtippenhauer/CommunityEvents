import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './user.entity';

export enum PointType {
  ATTENDANCE = 'attendance',
  COORDINATOR = 'coordinator',
  NEW_LOCATION_COORDINATOR = 'new_location_coordinator',
  INVITE = 'invite',
  RATING = 'rating',
  CITY_HOPPER = 'city_hopper',
  SECRET_DINNER = 'secret_dinner',
  ACHIEVEMENT = 'achievement',
}

@Entity('member_points')
export class MemberPointEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'point_type', type: 'enum', enum: PointType })
  pointType: PointType;

  @Column({ name: 'reference_id', type: 'int', unsigned: true })
  referenceId: number;

  @Column({ type: 'tinyint', default: 1 })
  points: number;

  @CreateDateColumn({ name: 'awarded_at' })
  awardedAt: Date;
}
