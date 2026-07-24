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
import { EventEntity } from './event.entity';
import { LocationEntity } from './location.entity';

@Entity('location_ratings')
export class LocationRatingEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'member_id', unsigned: true })
  memberId: number;

  @ManyToOne(() => UserEntity, { eager: false })
  @JoinColumn({ name: 'member_id' })
  member: UserEntity;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, { eager: false })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  @Column({ name: 'location_id', unsigned: true })
  locationId: number;

  @ManyToOne(() => LocationEntity, { eager: false })
  @JoinColumn({ name: 'location_id' })
  location: LocationEntity;

  @Column({ type: 'tinyint', unsigned: true })
  food: number;

  @Column({ type: 'tinyint', unsigned: true })
  service: number;

  @Column({ name: 'value_rating', type: 'tinyint', unsigned: true })
  valueRating: number;

  @Column({ type: 'tinyint', unsigned: true })
  noise: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
