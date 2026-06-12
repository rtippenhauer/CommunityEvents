import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { FeedbackEntity } from './feedback.entity';

@Entity('releases')
export class ReleaseEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 20 })
  version: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'published_at', type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'created_by', unsigned: true })
  createdBy: number;

  @ManyToOne(() => UserEntity, { eager: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  author: UserEntity;

  @ManyToMany(() => FeedbackEntity, { eager: false })
  @JoinTable({
    name: 'release_feedback',
    joinColumn: { name: 'release_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'feedback_id', referencedColumnName: 'id' },
  })
  linkedFeedback: FeedbackEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
