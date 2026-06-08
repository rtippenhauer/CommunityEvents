import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(RestaurantEntity)
    private readonly restaurantRepo: Repository<RestaurantEntity>,
  ) {}

  async getPublicStats(): Promise<{
    memberCount: number;
    dinnerCount: number;
    restaurantCount: number;
  }> {
    const [memberCount, dinnerCount, restaurantCount] = await Promise.all([
      this.userRepo.count({ where: { status: UserStatus.ACTIVE } }),
      this.eventRepo.count({ where: { status: EventStatus.PUBLISHED } }),
      this.restaurantRepo.count({ where: { isActive: true } }),
    ]);
    return { memberCount, dinnerCount, restaurantCount };
  }
}
