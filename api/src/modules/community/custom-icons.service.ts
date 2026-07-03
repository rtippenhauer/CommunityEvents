import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { CustomIconEntity } from '../../database/entities/custom-icon.entity';
import { AchievementEntity } from '../../database/entities/achievement.entity';

export interface CustomIconWithUsage extends CustomIconEntity {
  usageCount: number;
}

@Injectable()
export class CustomIconsService {
  constructor(
    @InjectRepository(CustomIconEntity)
    private readonly customIconRepo: Repository<CustomIconEntity>,
    @InjectRepository(AchievementEntity)
    private readonly achievementRepo: Repository<AchievementEntity>,
  ) {}

  private async usageCounts(): Promise<Map<string, number>> {
    const counts = await this.achievementRepo
      .createQueryBuilder('a')
      .select('a.icon', 'icon')
      .addSelect('COUNT(*)', 'count')
      .where('a.icon LIKE :prefix', { prefix: 'img:%' })
      .groupBy('a.icon')
      .getRawMany<{ icon: string; count: string }>();
    return new Map(counts.map((c) => [c.icon, Number(c.count)]));
  }

  async list(): Promise<CustomIconWithUsage[]> {
    const icons = await this.customIconRepo.find({ order: { name: 'ASC' } });
    if (icons.length === 0) return [];
    const countByIcon = await this.usageCounts();
    return icons.map((icon) => ({
      ...icon,
      usageCount: countByIcon.get(`img:${icon.imagePath}`) ?? 0,
    }));
  }

  async create(name: string, imagePath: string, createdBy: number): Promise<CustomIconEntity> {
    const icon = this.customIconRepo.create({ name, imagePath, createdBy });
    return this.customIconRepo.save(icon);
  }

  async delete(id: number): Promise<void> {
    const icon = await this.customIconRepo.findOne({ where: { id } });
    if (!icon) throw new NotFoundException('Icon not found');

    const countByIcon = await this.usageCounts();
    const usageCount = countByIcon.get(`img:${icon.imagePath}`) ?? 0;
    if (usageCount > 0) {
      throw new ConflictException(
        `This icon is used by ${usageCount} achievement(s) — change their icon before deleting it.`,
      );
    }

    await this.customIconRepo.delete(id);

    if (icon.imagePath.startsWith('/api/uploads/')) {
      const filename = icon.imagePath.replace('/api/uploads/', '');
      const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
      try {
        await unlink(join(uploadPath, filename));
      } catch {
        // Non-fatal — file may already be gone
      }
    }
  }
}
