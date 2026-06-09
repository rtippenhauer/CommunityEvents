import { Injectable, NotFoundException } from '@nestjs/common';
import { Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity, UserRole, UserStatus, EmailStatus } from '../../database/entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async findById(id: number): Promise<UserEntity> {
    const user = await this.userRepo.findOne({ where: { id }, relations: ['city'] });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(user: UserEntity, dto: UpdateProfileDto): Promise<UserEntity> {
    if (dto.fullName) user.fullName = dto.fullName;
    if (dto.cityId) user.cityId = dto.cityId;
    if (dto.profilePhotoPath === null) user.profilePhotoPath = null;
    return this.userRepo.save(user);
  }

  async updatePhotoPath(userId: number, path: string): Promise<void> {
    await this.userRepo.update(userId, { profilePhotoPath: path });
  }

  async setAvatar(userId: number, avatarPath: string): Promise<{ url: string }> {
    await this.userRepo.update(userId, { profilePhotoPath: avatarPath });
    return { url: avatarPath };
  }

  async updateEmailStatus(userId: number, status: EmailStatus): Promise<void> {
    await this.userRepo.update(userId, { emailStatus: status });
  }

  async findMembers(viewerRole: UserRole): Promise<object[]> {
    const isElevated = viewerRole === UserRole.ADMIN || viewerRole === UserRole.MODERATOR;

    const rows = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin(UserEntity, 'inviter', 'inviter.id = u.invited_by')
      .leftJoin('u.city', 'city')
      .select([
        'u.id AS id',
        'u.full_name AS fullName',
        'u.profile_photo_path AS profilePhotoPath',
        'u.city_id AS cityId',
        'city.name AS cityName',
        'u.created_at AS joinedAt',
        'u.invited_by AS invitedById',
        'inviter.full_name AS invitedByName',
        'inviter.profile_photo_path AS invitedByPhoto',
        ...(isElevated ? ['u.role AS role', 'u.status AS status'] : []),
      ])
      .where(isElevated ? 'u.status != :deleted' : 'u.status = :active', {
        deleted: UserStatus.DELETED,
        active: UserStatus.ACTIVE,
      })
      .orderBy('u.full_name', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      profilePhotoPath: r.profilePhotoPath,
      cityId: r.cityId,
      cityName: r.cityName ?? null,
      joinedAt: r.joinedAt,
      invitedBy: r.invitedById
        ? { id: r.invitedById, fullName: r.invitedByName, profilePhotoPath: r.invitedByPhoto }
        : null,
      ...(isElevated ? { role: r.role, status: r.status } : {}),
    }));
  }

  async findMemberProfile(
    id: number,
    viewerId: number,
    viewerRole: UserRole,
  ): Promise<object> {
    const user = await this.userRepo.findOne({ where: { id }, relations: ['city'] });
    if (!user || user.status === UserStatus.DELETED) throw new NotFoundException('Member not found');

    const isElevated = viewerRole === UserRole.ADMIN || viewerRole === UserRole.MODERATOR;
    const isSelf = viewerId === id;

    let invitedByInfo: { id: number; fullName: string; profilePhotoPath: string | null } | null = null;
    if (user.invitedBy) {
      const inviter = await this.userRepo.findOne({ where: { id: user.invitedBy } });
      if (inviter) {
        invitedByInfo = { id: inviter.id, fullName: inviter.fullName, profilePhotoPath: inviter.profilePhotoPath };
      }
    }

    let invitedMembers: Array<{ id: number; fullName: string; profilePhotoPath: string | null }> = [];
    if (isSelf || isElevated) {
      const members = await this.userRepo.find({
        where: { invitedBy: id, status: Not(UserStatus.DELETED) },
        select: ['id', 'fullName', 'profilePhotoPath'],
        order: { createdAt: 'ASC' },
      });
      invitedMembers = members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        profilePhotoPath: m.profilePhotoPath,
      }));
    }

    return {
      id: user.id,
      fullName: user.fullName,
      profilePhotoPath: user.profilePhotoPath,
      cityId: user.cityId,
      cityName: user.city?.name ?? null,
      joinedAt: user.createdAt,
      invitedBy: invitedByInfo,
      ...(isSelf || isElevated ? { invitedMembers } : {}),
      ...(isElevated ? { role: user.role, status: user.status } : {}),
    };
  }
}
