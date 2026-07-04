import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * Replaces an icon's stored image with a cleaned-up version at a brand-new
   * URL (rather than overwriting the same filename in place). An in-place
   * overwrite left the image vulnerable to being served stale indefinitely
   * by any caching layer between the browser and this server (browser cache,
   * or an upstream reverse proxy) that doesn't revalidate on every request —
   * a new filename can never collide with a previously-cached response.
   * Achievements referencing the old path (via `icon: 'img:<path>'`) are
   * repointed to the new one in the same operation.
   */
  async reprocessImage(id: number, newFilename: string): Promise<CustomIconEntity> {
    const icon = await this.customIconRepo.findOne({ where: { id } });
    if (!icon) throw new NotFoundException('Icon not found');
    if (!icon.imagePath.startsWith('/api/uploads/')) {
      throw new BadRequestException('Icon image is not stored locally');
    }

    const oldImagePath = icon.imagePath;
    const newImagePath = `/api/uploads/custom-icons/${newFilename}`;

    await this.achievementRepo.update({ icon: `img:${oldImagePath}` }, { icon: `img:${newImagePath}` });
    icon.imagePath = newImagePath;
    await this.customIconRepo.save(icon);

    const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
    try {
      await unlink(join(uploadPath, oldImagePath.replace('/api/uploads/', '')));
    } catch {
      // Non-fatal — old file may already be gone
    }

    return icon;
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
