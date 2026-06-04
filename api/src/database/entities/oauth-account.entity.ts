import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

export enum OAuthProvider {
  GOOGLE = 'google',
  FACEBOOK = 'facebook',
}

@Entity('oauth_accounts')
export class OAuthAccountEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'enum', enum: OAuthProvider })
  provider: OAuthProvider;

  @Column({ name: 'provider_id', length: 255 })
  providerId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
