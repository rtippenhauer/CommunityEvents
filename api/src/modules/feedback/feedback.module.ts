import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbackEntity } from '../../database/entities/feedback.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FeedbackEntity])],
  providers: [FeedbackService],
  controllers: [FeedbackController],
})
export class FeedbackModule {}
