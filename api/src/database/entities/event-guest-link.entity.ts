import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventEntity } from './event.entity';
import { EventRsvpEntity } from './event-rsvp.entity';
import { UserEntity } from './user.entity';

export type GuestLinkDeliveryType = 'email' | 'shareable';

@Entity('event_guest_links')
export class EventGuestLinkEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  @Column({ name: 'created_by', unsigned: true })
  createdById: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by' })
  createdBy: UserEntity;

  @Column({ name: 'member_rsvp_id', unsigned: true })
  memberRsvpId: number;

  @ManyToOne(() => EventRsvpEntity, (r) => r.guestLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_rsvp_id' })
  memberRsvp: EventRsvpEntity;

  @Column({
    name: 'delivery_type',
    type: 'enum',
    enum: ['email', 'shareable'],
    default: 'shareable',
  })
  deliveryType: GuestLinkDeliveryType;

  @Column({ name: 'recipient_name', type: 'varchar', length: 200, nullable: true })
  recipientName: string | null;

  @Column({ name: 'recipient_email', type: 'varchar', length: 255, nullable: true })
  recipientEmail: string | null;

  @Column({ length: 100, unique: true })
  token: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
