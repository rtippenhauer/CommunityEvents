import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackStatus } from '../../../database/enums';

/**
 * The operator's half: triage, not content.
 *
 * `title` and `body` are deliberately absent. They are the reporter's words,
 * and the operator editing them would rewrite what another community's admin
 * said while leaving their name on it.
 */
export class UpdateSystemBugDto {
  @IsEnum(FeedbackStatus)
  @IsOptional()
  status?: FeedbackStatus;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  adminNote?: string;
}
