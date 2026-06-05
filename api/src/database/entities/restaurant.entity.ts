import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CityEntity } from './city.entity';
import { RestaurantPhotoEntity } from './restaurant-photo.entity';

export enum ImportSource {
  MANUAL = 'manual',
  FACEBOOK_IMPORT = 'facebook_import',
}

@Entity('restaurants')
export class RestaurantEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 500 })
  address: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ name: 'website_url', type: 'varchar', length: 500, nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'city_id', unsigned: true })
  cityId: number;

  @ManyToOne(() => CityEntity)
  @JoinColumn({ name: 'city_id' })
  city: CityEntity;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({
    name: 'imported_from',
    type: 'enum',
    enum: ImportSource,
    default: ImportSource.MANUAL,
  })
  importedFrom: ImportSource;

  @OneToMany(() => RestaurantPhotoEntity, (photo) => photo.restaurant, { eager: true })
  photos: RestaurantPhotoEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
