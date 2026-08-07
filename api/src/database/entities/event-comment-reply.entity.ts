import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventCommentEntity } from './event-comment.entity';
import { UserEntity } from './user.entity';

@Entity('event_comment_replies')
export class EventCommentReplyEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'comment_id', unsigned: true })
  commentId: number;

  @ManyToOne(() => EventCommentEntity, (c) => c.replies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment: EventCommentEntity;

  @Column({ name: 'member_id', unsigned: true })
  memberId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'member_id' })
  member: UserEntity;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'edited_at', type: 'datetime', nullable: true })
  editedAt: Date | null;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
