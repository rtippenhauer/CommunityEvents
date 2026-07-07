import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityEntity } from '../../database/entities/city.entity';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';

@Injectable()
export class CitiesService {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
  ) {}

  findAll(): Promise<CityEntity[]> {
    return this.cityRepo.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  findAllAdmin(): Promise<CityEntity[]> {
    return this.cityRepo.find({ order: { name: 'ASC' } });
  }

  async findBySubdomain(subdomain: string): Promise<CityEntity> {
    const city = await this.cityRepo.findOne({ where: { subdomain, isActive: true } });
    if (!city) throw new NotFoundException(`City not found: ${subdomain}`);
    return city;
  }

  findBySubdomainOrNull(subdomain: string | undefined): Promise<CityEntity | null> {
    if (!subdomain) return Promise.resolve(null);
    return this.cityRepo.findOne({ where: { subdomain, isActive: true } });
  }

  async findById(id: number): Promise<CityEntity> {
    const city = await this.cityRepo.findOne({ where: { id, isActive: true } });
    if (!city) throw new NotFoundException(`City not found: ${id}`);
    return city;
  }

  async findByIdAdmin(id: number): Promise<CityEntity> {
    const city = await this.cityRepo.findOne({ where: { id } });
    if (!city) throw new NotFoundException(`City not found: ${id}`);
    return city;
  }

  private async assertSubdomainAvailable(subdomain: string, excludeId?: number): Promise<void> {
    const existing = await this.cityRepo.findOne({ where: { subdomain } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Subdomain '${subdomain}' is already in use`);
    }
  }

  async create(dto: CreateCityDto): Promise<CityEntity> {
    await this.assertSubdomainAvailable(dto.subdomain);
    const city = this.cityRepo.create(dto);
    return this.cityRepo.save(city);
  }

  async update(id: number, dto: UpdateCityDto): Promise<CityEntity> {
    const city = await this.findByIdAdmin(id);
    if (dto.subdomain && dto.subdomain !== city.subdomain) {
      await this.assertSubdomainAvailable(dto.subdomain, id);
    }
    Object.assign(city, dto);
    return this.cityRepo.save(city);
  }
}
