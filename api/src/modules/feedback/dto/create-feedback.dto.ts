import { IsEnum, IsString, MinLength, MaxLength } from 'class-validator';
import { FeedbackCategory } from '../../../database/entities/feedback.entity';

export class CreateFeedbackDto {
  @IsEnum(FeedbackCategory)
  category: FeedbackCategory;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  body: string;
}
