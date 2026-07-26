import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Preset avatars a member can pick as their profile picture. Per-instance and
// admin-managed (Phase 31): the compiled-in bear set is seeded by migration for
// DinnerBears, while a fresh fork starts empty and uploads its own via
// /admin/avatars. `path` is either a static asset path (/avatars/bear-*.jpg,
// shipped in the image) or an uploaded one (/api/uploads/avatars/...).
@Entity('avatar')
export class AvatarEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 500, unique: true })
  path: string;

  @Column({ length: 100 })
  label: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
