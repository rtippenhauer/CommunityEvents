import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';

export interface AdminUserRow {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  cityId: number;
  profilePhotoPath: string | null;
  invitedById: number | null;
  invitedByName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async getUsers(): Promise<AdminUserRow[]> {
    const users = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin(UserEntity, 'inviter', 'inviter.id = u.invited_by')
      .select([
        'u.id AS id',
        'u.full_name AS fullName',
        'u.email AS email',
        'u.role AS role',
        'u.status AS status',
        'u.city_id AS cityId',
        'u.profile_photo_path AS profilePhotoPath',
        'u.invited_by AS invitedById',
        'inviter.full_name AS invitedByName',
        'u.created_at AS createdAt',
        'u.last_login_at AS lastLoginAt',
        'u.login_count AS loginCount',
      ])
      .where('u.deleted_at IS NULL')
      .orderBy('u.created_at', 'DESC')
      .getRawMany<AdminUserRow>();

    return users;
  }
}
