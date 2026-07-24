import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { LocationEntity } from '../../database/entities/location.entity';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, EventEntity, LocationEntity])],
  providers: [StatsService],
  controllers: [StatsController],
})
export class StatsModule {}
