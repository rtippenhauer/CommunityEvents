import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { GeocodingService } from './geocoding.service';

@Module({
  imports: [TypeOrmModule.forFeature([RestaurantEntity, RestaurantPhotoEntity])],
  providers: [RestaurantsService, GeocodingService],
  controllers: [RestaurantsController],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
