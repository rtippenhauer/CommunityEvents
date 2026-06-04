import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLogEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true, nullable: true })
  userId: number | null;

  @Column({ length: 100 })
  action: string;

  @Column({ name: 'entity_type', length: 100, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', unsigned: true, nullable: true })
  entityId: number | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'ip_address', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
