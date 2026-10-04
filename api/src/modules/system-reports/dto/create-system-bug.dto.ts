import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * What a global report is (Rob, 2026-10-04).
 *
 * Both kinds are about the *product*, so both belong to whoever builds it. A
 * general comment is about a community -- its venues, its schedule, its people
 * -- and stays on that community's own tenant-scoped feedback board.
 */
export enum SystemReportCategory {
  BUG = 'bug',
  FEATURE_REQUEST = 'feature_request',
}

/**
 * A report about the product, bound for the deployment operator.
 *
 * **No privacy flag**, unlike `CreateFeedbackDto`: the board is shared by
 * construction, so a "private" option would be a promise this table cannot
 * keep. The form says who reads it rather than offering a toggle that would
 * have to be ignored.
 */
export class CreateSystemBugDto {
  @IsEnum(SystemReportCategory)
  category: SystemReportCategory;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  body: string;
}
