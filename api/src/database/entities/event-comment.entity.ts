import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventEntity } from './event.entity';
import { UserEntity } from './user.entity';
import { EventCommentReplyEntity } from './event-comment-reply.entity';

@Entity('event_comments')
export class EventCommentEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

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

  @OneToMany(() => EventCommentReplyEntity, (r) => r.comment)
  replies: EventCommentReplyEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
