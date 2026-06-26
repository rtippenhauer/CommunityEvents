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
import { CityEntity } from './city.entity';
import { RestaurantEntity } from './restaurant.entity';
import { UserEntity } from './user.entity';
import { EventRsvpEntity } from './event-rsvp.entity';

export enum EventStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CANCELLED = 'cancelled',
}

@Entity('events')
export class EventEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'city_id', unsigned: true })
  cityId: number;

  @ManyToOne(() => CityEntity)
  @JoinColumn({ name: 'city_id' })
  city: CityEntity;

  @Column({ name: 'restaurant_id', unsigned: true, nullable: true })
  restaurantId: number | null;

  @ManyToOne(() => RestaurantEntity, { nullable: true, eager: false })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: RestaurantEntity | null;

  // Snapshot fields — copied from restaurant at publish time
  @Column({ name: 'restaurant_name', length: 255 })
  restaurantName: string;

  @Column({ name: 'restaurant_address', length: 500 })
  restaurantAddress: string;

  @Column({ name: 'restaurant_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  restaurantLat: number | null;

  @Column({ name: 'restaurant_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  restaurantLng: number | null;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'additional_info', type: 'text', nullable: true })
  additionalInfo: string | null;

  @Column({ name: 'event_date', type: 'date' })
  eventDate: string;

  @Column({ name: 'event_time', type: 'time' })
  eventTime: string;

  @Column({
    type: 'enum',
    enum: EventStatus,
    default: EventStatus.DRAFT,
  })
  status: EventStatus;

  @Column({ name: 'published_at', type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_reason', type: 'text', nullable: true })
  cancelledReason: string | null;

  @Column({ name: 'facebook_share_text', type: 'text', nullable: true })
  facebookShareText: string | null;

  @Column({ name: 'reservation_assignee_id', unsigned: true, nullable: true })
  reservationAssigneeId: number | null;

  @ManyToOne(() => UserEntity, { nullable: true, eager: false })
  @JoinColumn({ name: 'reservation_assignee_id' })
  reservationAssignee: UserEntity | null;

  @Column({ name: 'reservation_contact_name', type: 'varchar', length: 150, nullable: true })
  reservationContactName: string | null;

  @Column({ name: 'reservation_contact_email', type: 'varchar', length: 255, nullable: true })
  reservationContactEmail: string | null;

  @Column({ name: 'reservation_confirmed', type: 'tinyint', default: 0 })
  reservationConfirmed: boolean;

  @Column({ name: 'reservation_confirmed_by', type: 'varchar', length: 255, nullable: true })
  reservationConfirmedBy: string | null;

  @Column({ name: 'reservation_confirmed_at', type: 'datetime', nullable: true })
  reservationConfirmedAt: Date | null;

  @Column({ name: 'reservation_confirmed_note', type: 'varchar', length: 500, nullable: true })
  reservationConfirmedNote: string | null;

  @Column({ name: 'reservation_seats_email_sent', type: 'tinyint', default: 0 })
  reservationSeatsEmailSent: boolean;

  @Column({ name: 'reservation_confirm_token', type: 'varchar', length: 64, nullable: true, unique: true })
  reservationConfirmToken: string | null;

  @Column({ name: 'created_by', unsigned: true })
  createdById: number;

  @ManyToOne(() => UserEntity, { eager: false })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity;

  @OneToMany(() => EventRsvpEntity, (r) => r.event)
  rsvps: EventRsvpEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
