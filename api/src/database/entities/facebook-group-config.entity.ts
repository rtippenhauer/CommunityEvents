import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CityEntity } from './city.entity';

export enum FacebookGroupRole {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
}

@Entity('facebook_group_config')
export class FacebookGroupConfigEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 500 })
  url: string;

  @Column({ name: 'group_id', type: 'varchar', length: 50, nullable: true })
  groupId: string | null;

  @Column({ name: 'city_id', type: 'int', unsigned: true, nullable: true })
  cityId: number | null;

  @ManyToOne(() => CityEntity, { nullable: true })
  @JoinColumn({ name: 'city_id' })
  city: CityEntity | null;

  @Column({
    name: 'group_role',
    type: 'enum',
    enum: FacebookGroupRole,
    default: FacebookGroupRole.PRIMARY,
  })
  groupRole: FacebookGroupRole;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
