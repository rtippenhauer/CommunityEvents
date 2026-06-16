import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('email_provider_config')
export class EmailProviderConfigEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'brevo_enabled', type: 'tinyint', default: 1 })
  brevoEnabled: boolean;

  @Column({ name: 'resend_overflow_enabled', type: 'tinyint', default: 0 })
  resendOverflowEnabled: boolean;

  @Column({ name: 'brevo_daily_limit', default: 300 })
  brevoDailyLimit: number;

  @Column({ name: 'resend_daily_limit', default: 1000 })
  resendDailyLimit: number;

  @Column({ name: 'brevo_sent_today', default: 0 })
  brevoSentToday: number;

  @Column({ name: 'resend_sent_today', default: 0 })
  resendSentToday: number;

  @Column({ name: 'last_reset_date', type: 'date' })
  lastResetDate: string;

  // Credentials (DB overrides env vars when set)
  @Column({ name: 'brevo_api_key', type: 'varchar', length: 500, nullable: true })
  brevoApiKey: string | null;

  @Column({ name: 'brevo_from_email', type: 'varchar', length: 255, nullable: true })
  brevoFromEmail: string | null;

  @Column({ name: 'brevo_from_name', type: 'varchar', length: 200, nullable: true })
  brevoFromName: string | null;

  @Column({ name: 'resend_api_key', type: 'varchar', length: 500, nullable: true })
  resendApiKey: string | null;

  @Column({ name: 'resend_from_email', type: 'varchar', length: 255, nullable: true })
  resendFromEmail: string | null;

  @Column({ name: 'resend_from_name', type: 'varchar', length: 200, nullable: true })
  resendFromName: string | null;

  // Brevo template IDs (DB overrides env vars when set)
  @Column({ name: 'tmpl_invite', type: 'int', unsigned: true, nullable: true })
  tmplInvite: number | null;

  @Column({ name: 'tmpl_security_alert', type: 'int', unsigned: true, nullable: true })
  tmplSecurityAlert: number | null;

  @Column({ name: 'tmpl_event_published', type: 'int', unsigned: true, nullable: true })
  tmplEventPublished: number | null;

  @Column({ name: 'tmpl_rsvp_confirmation', type: 'int', unsigned: true, nullable: true })
  tmplRsvpConfirmation: number | null;

  @Column({ name: 'tmpl_event_reminder', type: 'int', unsigned: true, nullable: true })
  tmplEventReminder: number | null;

  @Column({ name: 'tmpl_account_deletion', type: 'int', unsigned: true, nullable: true })
  tmplAccountDeletion: number | null;

  @Column({ name: 'tmpl_reengagement_60', type: 'int', unsigned: true, nullable: true })
  tmplReengagement60: number | null;

  @Column({ name: 'tmpl_reengagement_90', type: 'int', unsigned: true, nullable: true })
  tmplReengagement90: number | null;

  @Column({ name: 'tmpl_guest_rsvp_confirmation', type: 'int', unsigned: true, nullable: true })
  tmplGuestRsvpConfirmation: number | null;

  @Column({ name: 'tmpl_email_verification', type: 'int', unsigned: true, nullable: true })
  tmplEmailVerification: number | null;

  @Column({ name: 'tmpl_password_reset', type: 'int', unsigned: true, nullable: true })
  tmplPasswordReset: number | null;

  @Column({ name: 'tmpl_provider_disconnected', type: 'int', unsigned: true, nullable: true })
  tmplProviderDisconnected: number | null;

  @Column({ name: 'tmpl_account_deleted', type: 'int', unsigned: true, nullable: true })
  tmplAccountDeleted: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
