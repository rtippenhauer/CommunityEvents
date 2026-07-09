import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchConfigEntity } from '../../database/entities/merch-config.entity';
import { MerchService } from './merch.service';
import { MerchController } from './merch.controller';
import { CommunityModule } from '../community/community.module';

@Module({
  imports: [TypeOrmModule.forFeature([MerchConfigEntity]), CommunityModule],
  providers: [MerchService],
  controllers: [MerchController],
})
export class MerchModule {}
