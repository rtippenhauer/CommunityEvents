import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A defect report bound for the deployment operator.
 *
 * No category and no privacy flag, unlike `CreateFeedbackDto`. There is one
 * kind of thing here -- something is broken -- and the board is shared by
 * construction, so a "private" option would be a promise this table cannot
 * keep. The form says so in as many words rather than offering a toggle that
 * would have to be ignored.
 */
export class CreateSystemBugDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  body: string;
}
