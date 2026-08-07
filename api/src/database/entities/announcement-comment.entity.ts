import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { AnnouncementEntity } from './announcement.entity';

@Entity('announcement_comments')
export class AnnouncementCommentEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'announcement_id', unsigned: true })
  announcementId: number;

  @ManyToOne(() => AnnouncementEntity, (a) => a.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'announcement_id' })
  announcement: AnnouncementEntity;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'edited_at', type: 'datetime', nullable: true })
  editedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
