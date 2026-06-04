import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('login_sessions')
export class LoginSessionEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'jwt_jti', length: 100, unique: true })
  jwtJti: string;

  @Column({ name: 'user_agent', length: 500, nullable: true })
  userAgent: string | null;

  @Column({ name: 'ip_address', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ length: 100, nullable: true })
  country: string | null;

  @Column({ length: 100, nullable: true })
  city: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_active_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  lastActiveAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
