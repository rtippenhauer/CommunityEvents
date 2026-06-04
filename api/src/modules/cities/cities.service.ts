import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityEntity } from '../../database/entities/city.entity';

@Injectable()
export class CitiesService {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
  ) {}

  findAll(): Promise<CityEntity[]> {
    return this.cityRepo.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  async findBySubdomain(subdomain: string): Promise<CityEntity> {
    const city = await this.cityRepo.findOne({ where: { subdomain, isActive: true } });
    if (!city) throw new NotFoundException(`City not found: ${subdomain}`);
    return city;
  }

  async findById(id: number): Promise<CityEntity> {
    const city = await this.cityRepo.findOne({ where: { id, isActive: true } });
    if (!city) throw new NotFoundException(`City not found: ${id}`);
    return city;
  }
}
