import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { AvatarEntity } from '../../database/entities/avatar.entity';

export interface AvatarManifestEntry {
  id: number;
  path: string;
  label: string;
}

const UPLOADED_AVATAR_PREFIX = '/api/uploads/avatars/';

@Injectable()
export class AvatarsService {
  constructor(
    @InjectRepository(AvatarEntity)
    private readonly avatarRepo: Repository<AvatarEntity>,
  ) {}

  async getManifest(): Promise<AvatarManifestEntry[]> {
    const rows = await this.avatarRepo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    return rows.map((a) => ({ id: a.id, path: a.path, label: a.label }));
  }

  /** Whether a given path is one of this instance's preset avatars — the
   *  authoritative check for setAvatar (users can't set an arbitrary path). */
  async pathExists(path: string): Promise<boolean> {
    return (await this.avatarRepo.countBy({ path })) > 0;
  }

  async create(path: string, label: string): Promise<AvatarEntity> {
    const max = await this.avatarRepo
      .createQueryBuilder('a')
      .select('MAX(a.sortOrder)', 'max')
      .getRawOne<{ max: number | null }>();
    const avatar = this.avatarRepo.create({
      path,
      label,
      sortOrder: (max?.max ?? -1) + 1,
    });
    return this.avatarRepo.save(avatar);
  }

  async updateLabel(id: number, label: string): Promise<AvatarEntity> {
    const avatar = await this.avatarRepo.findOne({ where: { id } });
    if (!avatar) throw new NotFoundException('Avatar not found');
    avatar.label = label;
    return this.avatarRepo.save(avatar);
  }

  async remove(id: number): Promise<void> {
    const avatar = await this.avatarRepo.findOne({ where: { id } });
    if (!avatar) throw new NotFoundException('Avatar not found');
    await this.avatarRepo.delete(id);
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
}
