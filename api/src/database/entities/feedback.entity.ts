import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { FeedbackNoteEntity } from './feedback-note.entity';
import { FeedbackUpvoteEntity } from './feedback-upvote.entity';

export enum FeedbackCategory {
  BUG = 'bug',
  FEATURE_REQUEST = 'feature_request',
  COMMENT = 'comment',
}

export enum FeedbackStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  SHIPPED = 'shipped',
  CLOSED = 'closed',
  WONT_FIX = 'wont_fix',
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

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ type: 'enum', enum: FeedbackCategory })
  category: FeedbackCategory;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'enum', enum: FeedbackStatus, default: FeedbackStatus.OPEN })
  status: FeedbackStatus;

  @Column({ name: 'admin_note', type: 'text', nullable: true })
  adminNote: string | null;

  @Column({ name: 'release_note', type: 'varchar', length: 500, nullable: true })
  releaseNote: string | null;

  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  @Column({ name: 'upvote_count', type: 'int', unsigned: true, default: 0 })
  upvoteCount: number;

  @Column({ name: 'seen_at', type: 'datetime', nullable: true })
  seenAt: Date | null;

  @OneToMany(() => FeedbackNoteEntity, (note) => note.feedback, { eager: false })
  notes: FeedbackNoteEntity[];

  @OneToMany(() => FeedbackUpvoteEntity, (upvote) => upvote.feedback, { eager: false })
  upvotes: FeedbackUpvoteEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
