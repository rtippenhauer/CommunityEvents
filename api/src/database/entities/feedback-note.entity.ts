import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { FeedbackEntity } from './feedback.entity';

@Entity('feedback_notes')
export class FeedbackNoteEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'feedback_id', unsigned: true })
  feedbackId: number;

  @ManyToOne(() => FeedbackEntity, (fb) => fb.notes, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feedback_id' })
  feedback: FeedbackEntity;

  @Column({ name: 'author_id', unsigned: true })
  authorId: number;

  @ManyToOne(() => UserEntity, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: UserEntity;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'is_admin_only', type: 'boolean', default: false })
  isAdminOnly: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
