import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackAdminController } from './feedback-admin.controller';

@Module({
  providers: [FeedbackService],
  controllers: [FeedbackController, FeedbackAdminController],
  exports: [FeedbackService],
})
export class FeedbackModule {}
