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

@Entity('feedback_upvotes')
export class FeedbackUpvoteEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'feedback_id', unsigned: true })
  feedbackId: number;

  @ManyToOne(() => FeedbackEntity, (fb) => fb.upvotes, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feedback_id' })
  feedback: FeedbackEntity;

  @Column({ name: 'member_id', unsigned: true })
  memberId: number;

  @ManyToOne(() => UserEntity, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: UserEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
