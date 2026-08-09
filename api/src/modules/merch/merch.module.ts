import { Module } from '@nestjs/common';
import { MerchService } from './merch.service';
import { MerchController } from './merch.controller';
import { CommunityModule } from '../community/community.module';

@Module({
  imports: [ CommunityModule],
  providers: [MerchService],
  controllers: [MerchController],
})
export class MerchModule {}
