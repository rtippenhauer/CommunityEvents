import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class MarkFacebookAttendanceDto {
  @IsInt()
  @Min(1)
  eventId!: number;

  /**
   * Omitted means "not marked", which is a third state and not a synonym for
   * no-show -- an unreviewed dinner must not read as a room full of people who
   * did not come, and an admin needs a way back after a mistaken tap.
   */
  @IsOptional()
  @IsBoolean()
  attended?: boolean;
}
