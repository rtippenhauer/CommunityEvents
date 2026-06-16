import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum FacebookDeletionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

@Entity('facebook_deletion_requests')
export class FacebookDeletionRequestEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'facebook_user_id', length: 255 })
  facebookUserId: string;

  @Column({ name: 'confirmation_code', length: 100, unique: true })
  confirmationCode: string;

  @Column({ name: 'dinnerbears_user_id', type: 'int', unsigned: true, nullable: true })
  dinnerbearsUserId: number | null;

  @Column({ type: 'enum', enum: FacebookDeletionStatus, default: FacebookDeletionStatus.PENDING })
  status: FacebookDeletionStatus;

  @CreateDateColumn({ name: 'requested_at' })
  requestedAt: Date;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;
}
