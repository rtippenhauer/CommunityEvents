import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { cities as City } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';

@Injectable()
export class CitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<City[]> {
    return this.prisma.cities.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findAllAdmin(): Promise<City[]> {
    return this.prisma.cities.findMany({ orderBy: { name: 'asc' } });
  }

  async findBySubdomain(subdomain: string): Promise<City> {
    const city = await this.prisma.cities.findFirst({ where: { subdomain, isActive: true } });
    if (!city) throw new NotFoundException(`City not found: ${subdomain}`);
    return city;
  }

  findBySubdomainOrNull(subdomain: string | undefined): Promise<City | null> {
    if (!subdomain) return Promise.resolve(null);
    return this.prisma.cities.findFirst({ where: { subdomain, isActive: true } });
  }

  async findById(id: number): Promise<City> {
    const city = await this.prisma.cities.findFirst({ where: { id, isActive: true } });
    if (!city) throw new NotFoundException(`City not found: ${id}`);
    return city;
  }

  async findByIdAdmin(id: number): Promise<City> {
    const city = await this.prisma.cities.findUnique({ where: { id } });
    if (!city) throw new NotFoundException(`City not found: ${id}`);
    return city;
  }

  private async assertSubdomainAvailable(subdomain: string, excludeId?: number): Promise<void> {
    const existing = await this.prisma.cities.findUnique({ where: { subdomain } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Subdomain '${subdomain}' is already in use`);
    }
  }

  async create(dto: CreateCityDto): Promise<City> {
    await this.assertSubdomainAvailable(dto.subdomain);
    return this.prisma.cities.create({ data: dto });
  }

  async update(id: number, dto: UpdateCityDto): Promise<City> {
    const city = await this.findByIdAdmin(id);
    if (dto.subdomain && dto.subdomain !== city.subdomain) {
      await this.assertSubdomainAvailable(dto.subdomain, id);
    }
    return this.prisma.cities.update({ where: { id }, data: dto });
  }
}
