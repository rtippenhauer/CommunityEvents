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
import { EventEntity } from './event.entity';
import { EventGuestLinkEntity } from './event-guest-link.entity';
import { UserEntity } from './user.entity';

export enum RsvpStatus {
  GOING = 'going',
  MAYBE = 'maybe',
  NOT_GOING = 'not_going',
}

@Entity('event_rsvps')
export class EventRsvpEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, (e) => e.rsvps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'enum', enum: RsvpStatus, default: RsvpStatus.GOING })
  status: RsvpStatus;

  @Column({ name: 'additional_guests', type: 'tinyint', unsigned: true, default: 0 })
  additionalGuests: number;

  @Column({ name: 'guest_names', type: 'json', nullable: true })
  guestNames: string[] | null;

  @OneToMany(() => EventGuestLinkEntity, (l) => l.memberRsvp)
  guestLinks: EventGuestLinkEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
