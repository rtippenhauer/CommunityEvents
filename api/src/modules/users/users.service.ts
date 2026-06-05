import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
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
}
