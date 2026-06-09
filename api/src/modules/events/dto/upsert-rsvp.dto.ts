import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ArrayMaxSize } from 'class-validator';

export class UpsertRsvpDto {
  @IsInt()
  @Min(0)
  @Max(9)
  additionalGuests: number = 0;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @ArrayMaxSize(9)
  guestNames?: string[];
}
