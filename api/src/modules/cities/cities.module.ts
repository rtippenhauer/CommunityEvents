import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityEntity } from '../../database/entities/city.entity';
import { CitiesService } from './cities.service';
import { CitiesController } from './cities.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CityEntity])],
  providers: [CitiesService],
  controllers: [CitiesController],
  exports: [CitiesService],
})
export class CitiesModule {}
