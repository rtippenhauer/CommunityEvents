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
import { LocationPhotoEntity } from './location-photo.entity';
import { UserEntity } from './user.entity';

export enum ImportSource {
  MANUAL = 'manual',
  FACEBOOK_IMPORT = 'facebook_import',
}

@Entity('locations')
export class LocationEntity {
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

  // When true, address/lat/lng are withheld from members until they RSVP
  // "Going" to an event held here (or are admin/mod) — see
  // common/utils/location-visibility.util.ts.
  @Column({ name: 'is_private', default: false })
  isPrivate: boolean;

  @Column({
    name: 'imported_from',
    type: 'enum',
    enum: ImportSource,
    default: ImportSource.MANUAL,
  })
  importedFrom: ImportSource;

  @OneToMany(() => LocationPhotoEntity, (photo) => photo.location, { eager: true })
  photos: LocationPhotoEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'enriched_at', type: 'datetime', nullable: true })
  enrichedAt: Date | null;

  @Column({ name: 'created_by', unsigned: true, nullable: true })
  createdById: number | null;

  @ManyToOne(() => UserEntity, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;

  @Column({ name: 'updated_by', unsigned: true, nullable: true })
  updatedById: number | null;

  @ManyToOne(() => UserEntity, { nullable: true, eager: false })
  @JoinColumn({ name: 'updated_by' })
  updatedByUser: UserEntity | null;

  @Column({ name: 'moderator_notes', type: 'longtext', nullable: true, select: false })
  moderatorNotes: string | null;

  @Column({ name: 'contact_name', type: 'varchar', length: 100, nullable: true, select: false })
  contactName: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true, select: false })
  contactPhone: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 150, nullable: true, select: false })
  contactEmail: string | null;
}
