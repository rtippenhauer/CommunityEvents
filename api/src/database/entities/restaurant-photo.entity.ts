import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RestaurantEntity } from './restaurant.entity';
import { UserEntity } from './user.entity';

@Entity('restaurant_photos')
export class RestaurantPhotoEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'restaurant_id', unsigned: true })
  restaurantId: number;

  @ManyToOne(() => RestaurantEntity, (r) => r.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: RestaurantEntity;

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
