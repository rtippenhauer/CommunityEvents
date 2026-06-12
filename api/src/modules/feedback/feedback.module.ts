import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbackEntity } from '../../database/entities/feedback.entity';
import { FeedbackNoteEntity } from '../../database/entities/feedback-note.entity';
import { FeedbackUpvoteEntity } from '../../database/entities/feedback-upvote.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackAdminController } from './feedback-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FeedbackEntity, FeedbackNoteEntity, FeedbackUpvoteEntity])],
  providers: [FeedbackService],
  controllers: [FeedbackController, FeedbackAdminController],
  exports: [FeedbackService],
})
export class FeedbackModule {}
