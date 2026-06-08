import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
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

  async findMembers(viewerRole: UserRole): Promise<object[]> {
    const users = await this.userRepo.find({
      where: { status: UserStatus.ACTIVE },
      relations: ['city'],
      order: { fullName: 'ASC' },
    });
    const showRole = viewerRole === UserRole.ADMIN || viewerRole === UserRole.MODERATOR;
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      profilePhotoPath: u.profilePhotoPath,
      cityId: u.cityId,
      cityName: u.city?.name ?? null,
      joinedAt: u.createdAt,
      ...(showRole ? { role: u.role } : {}),
    }));
  }
}
