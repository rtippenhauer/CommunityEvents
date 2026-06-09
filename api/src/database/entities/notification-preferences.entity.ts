import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('notification_preferences')
export class NotificationPreferencesEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true, unique: true })
  userId: number;

  @OneToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'email_invite', type: 'tinyint', default: 1 })
  emailInvite: boolean;

  @Column({ name: 'email_verification', type: 'tinyint', default: 1 })
  emailVerification: boolean;

  @Column({ name: 'email_password_reset', type: 'tinyint', default: 1 })
  emailPasswordReset: boolean;

  @Column({ name: 'email_password_changed', type: 'tinyint', default: 1 })
  emailPasswordChanged: boolean;

  @Column({ name: 'email_security_alert', type: 'tinyint', default: 1 })
  emailSecurityAlert: boolean;

  @Column({ name: 'email_event_published', type: 'tinyint', default: 1 })
  emailEventPublished: boolean;

  @Column({ name: 'email_rsvp_confirmation', type: 'tinyint', default: 1 })
  emailRsvpConfirmation: boolean;

  @Column({ name: 'email_event_reminder', type: 'tinyint', default: 1 })
  emailEventReminder: boolean;

  @Column({ name: 'email_account_deletion', type: 'tinyint', default: 1 })
  emailAccountDeletion: boolean;

  @Column({ name: 'email_reengagement', type: 'tinyint', default: 1 })
  emailReengagement: boolean;

  @Column({ name: 'push_event_published', type: 'tinyint', default: 1 })
  pushEventPublished: boolean;

  @Column({ name: 'push_event_reminder', type: 'tinyint', default: 1 })
  pushEventReminder: boolean;

  @Column({ name: 'push_announcement', type: 'tinyint', default: 1 })
  pushAnnouncement: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
