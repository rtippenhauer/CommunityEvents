import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

export enum ReportContentType {
  EVENT_COMMENT = 'event_comment',
  EVENT_COMMENT_REPLY = 'event_comment_reply',
  ANNOUNCEMENT_COMMENT = 'announcement_comment',
  RESTAURANT_RATING = 'restaurant_rating',
}

export enum ReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
}

@Entity('content_reports')
export class ContentReportEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'reporter_id', unsigned: true })
  reporterId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_id' })
  reporter: UserEntity;

  @Column({ name: 'content_type', type: 'enum', enum: ReportContentType })
  contentType: ReportContentType;

  @Column({ name: 'content_id', unsigned: true })
  contentId: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @Column({ name: 'reviewed_by', unsigned: true, nullable: true })
  reviewedBy: number | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: UserEntity | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
