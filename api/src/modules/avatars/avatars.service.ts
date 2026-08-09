import { Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'path';
import { unlink } from 'fs/promises';
import type { avatar as Avatar } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface AvatarManifestEntry {
  id: number;
  path: string;
  label: string;
}

const UPLOADED_AVATAR_PREFIX = '/api/uploads/avatars/';

@Injectable()
export class AvatarsService {
  constructor(private readonly prisma: PrismaService) {}

  async getManifest(): Promise<AvatarManifestEntry[]> {
    const rows = await this.prisma.avatar.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((a) => ({ id: a.id, path: a.path, label: a.label }));
  }

  /** Whether a given path is one of this instance's preset avatars — the
   *  authoritative check for setAvatar (users can't set an arbitrary path). */
  async pathExists(path: string): Promise<boolean> {
    return (await this.prisma.avatar.count({ where: { path } })) > 0;
  }

  async create(path: string, label: string): Promise<Avatar> {
    const max = await this.prisma.avatar.aggregate({ _max: { sortOrder: true } });
    return this.prisma.avatar.create({
      data: { path, label, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
  }

  async updateLabel(id: number, label: string): Promise<Avatar> {
    await this.requireAvatar(id);
    return this.prisma.avatar.update({ where: { id }, data: { label } });
  }

  async remove(id: number): Promise<void> {
    const avatar = await this.requireAvatar(id);
    await this.prisma.avatar.delete({ where: { id } });
    // Best-effort cleanup of the underlying file for uploaded avatars. Static
    // /avatars/* assets ship in the image and are left alone. A member who had
    // this avatar selected keeps the now-dangling path; the frontend falls back
    // to a default when the image 404s.
    if (avatar.path.startsWith(UPLOADED_AVATAR_PREFIX)) {
      const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
      const filename = avatar.path.slice(UPLOADED_AVATAR_PREFIX.length);
      await unlink(join(uploadPath, 'avatars', filename)).catch(() => undefined);
    }
  }

  private async requireAvatar(id: number): Promise<Avatar> {
    const avatar = await this.prisma.avatar.findUnique({ where: { id } });
    if (!avatar) throw new NotFoundException('Avatar not found');
    return avatar;
  }
}
