import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Min } from 'class-validator';

export class MuseEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId?: number;

  /**
   * `YYYY-MM-DD`, replacing the default "upcoming" filter.
   *
   * A plain date and never a timestamp: every date in this schema is a DATE
   * column read as an Eastern wall-clock day, and accepting an ISO instant here
   * would make "events from the 7th" mean different days depending on the
   * caller's timezone. The same trap `v2-11` found when write endpoints
   * returned ISO where reads returned date strings.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate?: string;
}
