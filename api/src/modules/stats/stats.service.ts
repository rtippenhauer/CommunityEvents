import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { LocationEntity } from '../../database/entities/location.entity';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(LocationEntity)
    private readonly locationRepo: Repository<LocationEntity>,
  ) {}

  async getPublicStats(): Promise<{
    memberCount: number;
    dinnerCount: number;
    locationCount: number;
  }> {
    const [memberCount, dinnerCount, locationCount] = await Promise.all([
      this.userRepo.count({ where: { status: UserStatus.ACTIVE } }),
      this.eventRepo.count({ where: { status: EventStatus.PUBLISHED } }),
      this.locationRepo.count({ where: { isActive: true } }),
    ]);
    return { memberCount, dinnerCount, locationCount };
  }
}
