import { Module } from '@nestjs/common';
import { FacebookGroupsService } from './facebook-groups.service';
import { FacebookGroupsController } from './facebook-groups.controller';

@Module({
  providers: [FacebookGroupsService],
  controllers: [FacebookGroupsController],
  exports: [FacebookGroupsService],
})
export class FacebookGroupsModule {}
