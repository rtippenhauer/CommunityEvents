import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum SuppressionReason {
  UNSUBSCRIBED = 'unsubscribed',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
}

@Entity('email_suppressions')
export class EmailSuppressionEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'email_hash', length: 255, unique: true })
  emailHash: string;

  @Column({ type: 'enum', enum: SuppressionReason })
  reason: SuppressionReason;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
