import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('email_provider_config')
export class EmailProviderConfigEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'brevo_enabled', type: 'tinyint', default: 1 })
  brevoEnabled: boolean;

  @Column({ name: 'gmail_overflow_enabled', type: 'tinyint', default: 0 })
  gmailOverflowEnabled: boolean;

  @Column({ name: 'brevo_daily_limit', default: 300 })
  brevoDailyLimit: number;

  @Column({ name: 'gmail_daily_limit', default: 500 })
  gmailDailyLimit: number;

  @Column({ name: 'brevo_sent_today', default: 0 })
  brevoSentToday: number;

  @Column({ name: 'gmail_sent_today', default: 0 })
  gmailSentToday: number;

  @Column({ name: 'last_reset_date', type: 'date' })
  lastResetDate: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
