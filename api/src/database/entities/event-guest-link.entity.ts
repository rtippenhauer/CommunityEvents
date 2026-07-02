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
export type GuestLinkSource = 'member' | 'public';

@Entity('event_guest_links')
export class EventGuestLinkEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  @Column({ name: 'created_by', unsigned: true, nullable: true })
  createdById: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: UserEntity | null;

  @Column({ name: 'member_rsvp_id', unsigned: true, nullable: true })
  memberRsvpId: number | null;

  @ManyToOne(() => EventRsvpEntity, (r) => r.guestLinks, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'member_rsvp_id' })
  memberRsvp: EventRsvpEntity | null;

  @Column({
    name: 'delivery_type',
    type: 'enum',
    enum: ['email', 'shareable'],
    default: 'shareable',
  })
  deliveryType: GuestLinkDeliveryType;

  @Column({ type: 'enum', enum: ['member', 'public'], default: 'member' })
  source: GuestLinkSource;

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

  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'tinyint', nullable: true, default: null })
  attended: boolean | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
