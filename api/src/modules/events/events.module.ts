import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from '../../database/entities/event.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EventEntity, RestaurantEntity])],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
