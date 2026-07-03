import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomIconEntity } from '../../database/entities/custom-icon.entity';

@Injectable()
export class CustomIconsService {
  constructor(
    @InjectRepository(CustomIconEntity)
    private readonly customIconRepo: Repository<CustomIconEntity>,
  ) {}

  async list(): Promise<CustomIconEntity[]> {
    return this.customIconRepo.find({ order: { name: 'ASC' } });
  }

  async create(name: string, imagePath: string, createdBy: number): Promise<CustomIconEntity> {
    const icon = this.customIconRepo.create({ name, imagePath, createdBy });
    return this.customIconRepo.save(icon);
  }
}
