import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The only shape a screenshot reference may take.
 *
 * **Not a URL.** These render as `<img src>` on a board the administrators of
 * every community read, so an arbitrary URL accepted here would be a tracking
 * pixel telling whoever filed the report which communities looked at it and
 * when -- and a way to put a chosen image in front of every operator on the
 * deployment. Only a filename produced by this module's own upload route is
 * accepted, and the pattern allows no slashes beyond the fixed prefix, so it
 * cannot be walked out of the uploads directory either.
 *
 * The prefix gained `reports/` on 2026-10-05: only named subdirectories are
 * served as static assets, so a file written to the uploads root stored fine
 * and then 404'd. Tightening the pattern with it means an old flat path is now
 * refused rather than silently accepted and broken.
 */
const SCREENSHOT_PATH = /^\/api\/uploads\/reports\/[A-Za-z0-9._-]+$/;

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

  /**
   * Upload paths from `POST /system/bugs/images`, at most five.
   *
   * Bounded because they are rendered inline on a shared board and because a
   * report needing more than five pictures is one that needs a sentence.
   */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(SCREENSHOT_PATH, { each: true, message: 'screenshots must be uploaded here first' })
  screenshots?: string[];
}
