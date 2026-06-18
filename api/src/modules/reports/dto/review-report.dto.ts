import { IsEnum } from 'class-validator';

export enum ReviewAction {
  DISMISS = 'dismiss',
  DELETE_AND_DISMISS = 'delete_and_dismiss',
}

export class ReviewReportDto {
  @IsEnum(ReviewAction)
  action: ReviewAction;
}
