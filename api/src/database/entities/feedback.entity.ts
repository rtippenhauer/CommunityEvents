import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

export enum FeedbackCategory {
  BUG = 'bug',
  FEATURE_REQUEST = 'feature_request',
  COMMENT = 'comment',
}

export enum FeedbackStatus {
  NEW = 'new',
  UNDER_REVIEW = 'under_review',
  IN_PROGRESS = 'in_progress',
  RELEASED = 'released',
  WONT_DO = 'wont_do',
  DUPLICATE = 'duplicate',
}

@Entity('feedback')
export class FeedbackEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'enum', enum: FeedbackCategory })
  category: FeedbackCategory;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'enum', enum: FeedbackStatus, default: FeedbackStatus.NEW })
  status: FeedbackStatus;

  @Column({ name: 'admin_note', type: 'text', nullable: true })
  adminNote: string | null;

  @Column({ name: 'seen_at', type: 'datetime', nullable: true })
  seenAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
