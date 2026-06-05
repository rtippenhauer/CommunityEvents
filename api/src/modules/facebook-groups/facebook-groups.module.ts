import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacebookGroupConfigEntity } from '../../database/entities/facebook-group-config.entity';
import { FacebookGroupsService } from './facebook-groups.service';
import { FacebookGroupsController } from './facebook-groups.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FacebookGroupConfigEntity])],
  providers: [FacebookGroupsService],
  controllers: [FacebookGroupsController],
  exports: [FacebookGroupsService],
})
export class FacebookGroupsModule {}
