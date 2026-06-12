import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackStatus } from '../../../database/entities/feedback.entity';

export class UpdateFeedbackDto {
  @IsEnum(FeedbackStatus)
  @IsOptional()
  status?: FeedbackStatus;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  adminNote?: string | null;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  releaseNote?: string | null;
}
