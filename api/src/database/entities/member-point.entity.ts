import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './user.entity';

export enum PointType {
  ATTENDANCE = 'attendance',
  COORDINATOR = 'coordinator',
  COORDINATOR_NEW_RESTAURANT = 'coordinator_new_restaurant',
  INVITE = 'invite',
  RATING = 'rating',
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

  @Column({ name: 'reference_id', type: 'int', unsigned: true, nullable: true })
  referenceId: number | null;

  @Column({ type: 'tinyint', default: 1 })
  points: number;

  @CreateDateColumn({ name: 'awarded_at' })
  awardedAt: Date;
}
