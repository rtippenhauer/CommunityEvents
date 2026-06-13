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
import { CityEntity } from './city.entity';
import { AnnouncementCommentEntity } from './announcement-comment.entity';

export enum AnnouncementStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

@Entity('announcements')
export class AnnouncementEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'longtext' })
  body: string;

  @Column({ name: 'city_id', unsigned: true, nullable: true })
  cityId: number | null;

  @ManyToOne(() => CityEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'city_id' })
  city: CityEntity | null;

  @Column({ type: 'enum', enum: AnnouncementStatus, default: AnnouncementStatus.DRAFT })
  status: AnnouncementStatus;

  @Column({ name: 'published_at', type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'created_by', unsigned: true })
  createdBy: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by' })
  author: UserEntity;

  @OneToMany(() => AnnouncementCommentEntity, (c) => c.announcement)
  comments: AnnouncementCommentEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
