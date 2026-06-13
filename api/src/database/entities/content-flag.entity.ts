import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

export enum FlagContentType {
  ANNOUNCEMENT = 'announcement',
  ANNOUNCEMENT_COMMENT = 'announcement_comment',
}

export enum FlagStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
}

@Entity('content_flags')
export class ContentFlagEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'content_type', type: 'enum', enum: FlagContentType })
  contentType: FlagContentType;

  @Column({ name: 'content_id', unsigned: true })
  contentId: number;

  @Column({ name: 'reported_by', unsigned: true })
  reportedBy: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'reported_by' })
  reporter: UserEntity;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'enum', enum: FlagStatus, default: FlagStatus.PENDING })
  status: FlagStatus;

  @Column({ name: 'reviewed_by', unsigned: true, nullable: true })
  reviewedBy: number | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: UserEntity | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
