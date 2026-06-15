import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventCommentEntity } from '../../database/entities/event-comment.entity';
import { EventCommentReplyEntity } from '../../database/entities/event-comment-reply.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventCommentsService } from './event-comments.service';
import { EventCommentsController } from './event-comments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EventCommentEntity, EventCommentReplyEntity, EventEntity])],
  providers: [EventCommentsService],
  controllers: [EventCommentsController],
})
export class EventCommentsModule {}
