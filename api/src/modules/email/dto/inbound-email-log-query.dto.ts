import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { InboundEmailOutcome } from '../../../database/enums';

/**
 * How the inbound mail log is filtered (v2-34).
 *
 * Shaped after `EmailLogQueryDto` and for the same reasons: the values reach a
 * database query, and `limit` especially is a number a mistake turns into a
 * full table scan. `ValidationPipe` is global with `transform: true`, so the
 * `@Type`/`@Transform` conversions are what turn query strings into the numbers
 * and booleans the service expects.
 *
 * Two fields are **operator-only** (`tenantId`, `unresolvedOnly`). They are
 * declared here rather than in a second DTO because the difference between the
 * two reads is not which filters are offered -- it is which *method* applies
 * them: `listForTenant` ignores both and pins the tenant itself, so a community
 * sending `?tenantId=` cannot widen its own view.
 */
export class InboundEmailLogQueryDto {
  /** Free text over the envelope: who it was from, who it was to, the subject. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  /**
   * One exact outcome. Validated against the known set rather than taken
   * free-form, so a typo reads as a refusal instead of an empty log.
   */
  @IsOptional()
  @IsIn(Object.values(InboundEmailOutcome))
  outcome?: string;

  /**
   * Everything except `recorded` and `unchanged` — the one filter anybody
   * actually wants, since the question is always "what went wrong". Applied
   * after `outcome`, so passing both narrows to the stricter.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  failuresOnly?: boolean;

  /**
   * Operator-only: one community's rows, named rather than derived from the
   * host. Ignored by `listForTenant`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tenantId?: number;

  /**
   * Operator-only: only the rows that matched **no** community. The rows no
   * tenant-facing query can return, and the shape a multi-tenant fault takes.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  unresolvedOnly?: boolean;

  /**
   * Inclusive bounds on arrival, as `YYYY-MM-DD` or a full ISO instant.
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

  /** Capped at 200, as the outbound log is: an uncapped limit is how a log endpoint becomes a bulk export. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
