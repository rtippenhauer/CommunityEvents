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
import { RestaurantEntity } from './restaurant.entity';

@Entity('restaurant_ratings')
export class RestaurantRatingEntity {
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

  @Column({ name: 'restaurant_id', unsigned: true })
  restaurantId: number;

  @ManyToOne(() => RestaurantEntity, { eager: false })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: RestaurantEntity;

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
