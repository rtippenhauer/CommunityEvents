import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmailQueueStatus } from '../../../database/enums';

/**
 * How the admin email log is filtered (v2-31).
 *
 * A query DTO rather than hand-parsed `@Query()` strings, for the same reason
 * every request body has one: the values reach a database query, and `limit`
 * especially is a number an anonymous-shaped mistake can turn into a full table
 * scan. `ValidationPipe` is global with `transform: true`, so the `@Type` and
 * `@Transform` conversions below are what turn query strings into the numbers
 * and dates the service expects.
 */
export class EmailLogQueryDto {
  /**
   * Free text, matched against recipient address, recipient name and subject.
   *
   * Those three because they are what somebody actually remembers about a
   * message they are hunting for. Deliberately not the body: it is LongText,
   * nothing indexes it, and "did this person get their invite" is answered by
   * the envelope.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional()
  @IsIn(Object.values(EmailQueueStatus))
  status?: string;

  /**
   * Inclusive date bounds on when the message was created, as `YYYY-MM-DD` or a
   * full ISO instant.
   *
   * Validated as ISO rather than coerced with `new Date()`, which turns
   * nonsense into `Invalid Date` and then into a query that silently matches
   * nothing — a filter that appears to work and returns an empty log is worse
   * than one that refuses.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Capped at 200. The row list omits bodies, so a page is small, but an
   * uncapped limit is how a log endpoint becomes a way to pull a community's
   * entire mail history in one request.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
