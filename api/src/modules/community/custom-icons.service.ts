import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async list(): Promise<CustomIconWithUsage[]> {
    const icons = await this.customIconRepo.find({ order: { name: 'ASC' } });
    if (icons.length === 0) return [];

    const counts = await this.achievementRepo
      .createQueryBuilder('a')
      .select('a.icon', 'icon')
      .addSelect('COUNT(*)', 'count')
      .where('a.icon LIKE :prefix', { prefix: 'img:%' })
      .groupBy('a.icon')
      .getRawMany<{ icon: string; count: string }>();
    const countByIcon = new Map(counts.map((c) => [c.icon, Number(c.count)]));

    return icons.map((icon) => ({
      ...icon,
      usageCount: countByIcon.get(`img:${icon.imagePath}`) ?? 0,
    }));
  }

  async create(name: string, imagePath: string, createdBy: number): Promise<CustomIconEntity> {
    const icon = this.customIconRepo.create({ name, imagePath, createdBy });
    return this.customIconRepo.save(icon);
  }
}
