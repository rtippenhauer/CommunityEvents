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

export enum UserRole {
  MEMBER = 'member',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export enum EmailStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  UNSUBSCRIBED = 'unsubscribed',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
}

export enum InviteSource {
  DIRECT = 'direct',
  FACEBOOK_GROUP = 'facebook_group',
  GOOGLE_OAUTH = 'google_oauth',
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'full_name', length: 200 })
  fullName: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({
    name: 'email_status',
    type: 'enum',
    enum: EmailStatus,
    default: EmailStatus.PENDING,
  })
  emailStatus: EmailStatus;

  @Column({ name: 'email_verified_at', type: 'datetime', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ name: 'city_id', unsigned: true })
  cityId: number;

  @ManyToOne(() => CityEntity)
  @JoinColumn({ name: 'city_id' })
  city: CityEntity;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.MEMBER })
  role: UserRole;

  @Column({ name: 'profile_photo_path', type: 'varchar', length: 500, nullable: true })
  profilePhotoPath: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ name: 'invited_by', type: 'int', unsigned: true, nullable: true })
  invitedBy: number | null;

  @Column({ name: 'invite_id', type: 'int', unsigned: true, nullable: true })
  inviteId: number | null;

  @Column({
    name: 'invite_source',
    type: 'enum',
    enum: InviteSource,
    nullable: true,
  })
  inviteSource: InviteSource | null;

  @Column({ name: 'invite_source_name', type: 'varchar', length: 255, nullable: true })
  inviteSourceName: string | null;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'login_count', unsigned: true, default: 0 })
  loginCount: number;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'hard_delete_at', type: 'datetime', nullable: true })
  hardDeleteAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
