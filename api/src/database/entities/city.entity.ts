import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('cities')
export class CityEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 50, unique: true })
  subdomain: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
