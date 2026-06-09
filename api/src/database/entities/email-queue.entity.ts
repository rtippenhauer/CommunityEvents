import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum EmailQueueStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  BLOCKED = 'blocked',
}

export enum EmailProvider {
  BREVO = 'brevo',
  GMAIL = 'gmail',
}

@Entity('email_queue')
export class EmailQueueEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'to_email', length: 255 })
  toEmail: string;

  @Column({ name: 'to_name', type: 'varchar', length: 200, nullable: true })
  toName: string | null;

  @Column({ length: 500 })
  subject: string;

  @Column({ name: 'template_id', type: 'varchar', length: 100, nullable: true })
  templateId: string | null;

  @Column({ name: 'template_params', type: 'json', nullable: true })
  templateParams: Record<string, unknown> | null;

  @Column({ name: 'html_body', type: 'longtext', nullable: true })
  htmlBody: string | null;

  @Column({ name: 'text_body', type: 'text', nullable: true })
  textBody: string | null;

  @Column({ type: 'tinyint', default: 5 })
  priority: number;

  @Column({
    type: 'enum',
    enum: EmailQueueStatus,
    default: EmailQueueStatus.PENDING,
  })
  status: EmailQueueStatus;

  @Column({ type: 'enum', enum: EmailProvider, nullable: true })
  provider: EmailProvider | null;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'last_attempt_at', type: 'datetime', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'brevo_status', type: 'varchar', length: 100, nullable: true })
  brevoStatus: string | null;

  @Column({ name: 'send_after', type: 'datetime', nullable: true })
  sendAfter: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt: Date | null;
}
