import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import type { custom_icons as CustomIcon } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface CustomIconWithUsage extends CustomIcon {
  usageCount: number;
}

@Injectable()
export class CustomIconsService {
  constructor(private readonly prisma: PrismaService) {}

  private async usageCounts(): Promise<Map<string, number>> {
    const counts = await this.prisma.achievements.groupBy({
      by: ['icon'],
      where: { icon: { startsWith: 'img:' } },
      _count: { icon: true },
    });
    return new Map(counts.map((c) => [c.icon, c._count.icon]));
  }

  async list(): Promise<CustomIconWithUsage[]> {
    const icons = await this.prisma.custom_icons.findMany({ orderBy: { name: 'asc' } });
    if (icons.length === 0) return [];
    const countByIcon = await this.usageCounts();
    return icons.map((icon) => ({
      ...icon,
      usageCount: countByIcon.get(`img:${icon.imagePath}`) ?? 0,
    }));
  }

  async create(name: string, imagePath: string, createdBy: number): Promise<CustomIcon> {
    return this.prisma.custom_icons.create({ data: { name, imagePath, createdBy } });
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
  async reprocessImage(id: number, newFilename: string): Promise<CustomIcon> {
    const icon = await this.prisma.custom_icons.findUnique({ where: { id } });
    if (!icon) throw new NotFoundException('Icon not found');
    if (!icon.imagePath.startsWith('/api/uploads/')) {
      throw new BadRequestException('Icon image is not stored locally');
    }

    const oldImagePath = icon.imagePath;
    const newImagePath = `/api/uploads/custom-icons/${newFilename}`;

    await this.prisma.achievements.updateMany({
      where: { icon: `img:${oldImagePath}` },
      data: { icon: `img:${newImagePath}` },
    });
    const updated = await this.prisma.custom_icons.update({
      where: { id },
      data: { imagePath: newImagePath },
    });

    const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
    try {
      await unlink(join(uploadPath, oldImagePath.replace('/api/uploads/', '')));
    } catch {
      // Non-fatal — old file may already be gone
    }

    return updated;
  }

  async delete(id: number): Promise<void> {
    const icon = await this.prisma.custom_icons.findUnique({ where: { id } });
    if (!icon) throw new NotFoundException('Icon not found');

    const countByIcon = await this.usageCounts();
    const usageCount = countByIcon.get(`img:${icon.imagePath}`) ?? 0;
    if (usageCount > 0) {
      throw new ConflictException(
        `This icon is used by ${usageCount} achievement(s) — change their icon before deleting it.`,
      );
    }

    await this.prisma.custom_icons.delete({ where: { id } });

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
