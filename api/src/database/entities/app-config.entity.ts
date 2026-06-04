import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('app_config')
export class AppConfigEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'config_key', length: 100, unique: true })
  configKey: string;

  @Column({ name: 'config_value', type: 'text' })
  configValue: string;

  @Column({ length: 500, nullable: true })
  description: string | null;

  @Column({ name: 'updated_by', unsigned: true, nullable: true })
  updatedBy: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
