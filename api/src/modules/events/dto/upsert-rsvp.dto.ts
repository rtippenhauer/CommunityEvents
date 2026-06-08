import { IsInt, Max, Min } from 'class-validator';

export class UpsertRsvpDto {
  @IsInt()
  @Min(0)
  @Max(9)
  additionalGuests: number = 0;
}
