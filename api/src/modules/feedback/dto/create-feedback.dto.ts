import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The only shape an attachment reference may take.
 *
 * Not a URL: these render as `<img src>` on the board, the detail page and the
 * admin screen, so an arbitrary URL would be a tracking pixel or a way to put a
 * chosen image in front of a community's admins. Only a filename this module's
 * own upload route produced is accepted, and no slashes are allowed past the
 * fixed prefix, so it cannot be walked out of the uploads directory.
 */
const ATTACHMENT_PATH = /^\/api\/uploads\/feedback\/[A-Za-z0-9._-]+$/;
import { FeedbackCategory } from '../../../database/enums';

export class CreateFeedbackDto {
  @IsEnum(FeedbackCategory)
  category: FeedbackCategory;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  body: string;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  /**
   * Images attached to the ticket, at most five.
   *
   * Deliberately separate from `body`: an embedded screenshot used to count
   * against the body's length limits, which made a two-screenshot ticket too
   * long and a screenshots-only ticket too short.
   */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(ATTACHMENT_PATH, { each: true, message: 'images must be uploaded here first' })
  screenshots?: string[];
}
