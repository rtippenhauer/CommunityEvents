import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, EventEntity, RestaurantEntity])],
  providers: [StatsService],
  controllers: [StatsController],
})
export class StatsModule {}
