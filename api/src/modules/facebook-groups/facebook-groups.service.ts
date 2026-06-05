import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FacebookGroupConfigEntity } from '../../database/entities/facebook-group-config.entity';

@Injectable()
export class FacebookGroupsService {
  constructor(
    @InjectRepository(FacebookGroupConfigEntity)
    private readonly repo: Repository<FacebookGroupConfigEntity>,
  ) {}

  findAll(): Promise<FacebookGroupConfigEntity[]> {
    return this.repo.find({ where: { isActive: true }, relations: ['city'] });
  }
}
