import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { CityEntity } from './city.entity';
import { FacebookGroupConfigEntity } from './facebook-group-config.entity';

export enum InviteType {
  MEMBER = 'member',
  ADMIN = 'admin',
  CAMPAIGN_FACEBOOK = 'campaign_facebook',
  GUEST_RSVP = 'guest_rsvp',
  SHAREABLE_RSVP = 'shareable_rsvp',
}

@Entity('invites')
export class InviteEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 100, unique: true })
  token: string;

  @Column({ type: 'enum', enum: InviteType })
  type: InviteType;

  @Column({ name: 'created_by', unsigned: true })
  createdBy: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by' })
  creator: UserEntity;

  @Column({ name: 'city_id', unsigned: true, nullable: true })
  cityId: number | null;

  @ManyToOne(() => CityEntity, { nullable: true })
  @JoinColumn({ name: 'city_id' })
  city: CityEntity | null;

  @Column({ name: 'event_id', unsigned: true, nullable: true })
  eventId: number | null;

  @Column({ name: 'facebook_group_id', unsigned: true, nullable: true })
  facebookGroupId: number | null;

  @ManyToOne(() => FacebookGroupConfigEntity, { nullable: true })
  @JoinColumn({ name: 'facebook_group_id' })
  facebookGroup: FacebookGroupConfigEntity | null;

  @Column({ name: 'bound_to_email', length: 255, nullable: true })
  boundToEmail: string | null;

  @Column({ name: 'bound_to_name', length: 200, nullable: true })
  boundToName: string | null;

  @Column({ name: 'redeemed_by', unsigned: true, nullable: true })
  redeemedBy: number | null;

  @Column({ name: 'redeemed_at', type: 'datetime', nullable: true })
  redeemedAt: Date | null;

  @Column({ name: 'guest_rsvp_id', unsigned: true, nullable: true })
  guestRsvpId: number | null;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'is_revoked', default: false })
  isRevoked: boolean;

  @Column({ name: 'max_uses', type: 'int', nullable: true, default: 1 })
  maxUses: number | null;

  @Column({ name: 'use_count', default: 0 })
  useCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
