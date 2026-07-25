import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LocationEntity } from './location.entity';
import { UserEntity } from './user.entity';

@Entity('location_photos')
export class LocationPhotoEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'location_id', unsigned: true })
  locationId: number;

  @ManyToOne(() => LocationEntity, (l) => l.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location: LocationEntity;

  @Column({ name: 'file_path', length: 500 })
  filePath: string;

  @Column({ name: 'file_name', length: 255 })
  fileName: string;

  @Column({ name: 'mime_type', length: 100 })
  mimeType: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'uploaded_by', unsigned: true })
  uploadedBy: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'uploaded_by' })
  uploader: UserEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
