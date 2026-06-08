import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';

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

  async banUser(targetId: number, actorId: number, actorRole: UserRole): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot ban yourself');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot ban an admin');
    if (actorRole === UserRole.MODERATOR && target.role !== UserRole.MEMBER) {
      throw new ForbiddenException('Moderators can only ban regular members');
    }
    if (target.status === UserStatus.SUSPENDED) throw new BadRequestException('User is already banned');
    await this.userRepo.update(targetId, { status: UserStatus.SUSPENDED });
  }

  async forceBanUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot ban yourself');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot ban an admin');
    await this.userRepo.update(targetId, {
      status: UserStatus.DELETED,
      deletedAt: new Date(),
    });
  }

  async unbanUser(targetId: number): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status === UserStatus.ACTIVE) throw new BadRequestException('User is not banned');
    await this.userRepo.update(targetId, { status: UserStatus.ACTIVE, deletedAt: null });
  }

  async setRole(targetId: number, actorId: number, role: UserRole): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot change your own role');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot change another admin\'s role');
    if (role === UserRole.ADMIN) throw new ForbiddenException('Cannot promote to admin — set directly in the database');
    await this.userRepo.update(targetId, { role });
  }
}
