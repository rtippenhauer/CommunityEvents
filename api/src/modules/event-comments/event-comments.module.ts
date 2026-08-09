import { Module } from '@nestjs/common';
import { EventCommentsService } from './event-comments.service';
import { EventCommentsController } from './event-comments.controller';

@Module({
  providers: [EventCommentsService],
  controllers: [EventCommentsController],
})
export class EventCommentsModule {}
