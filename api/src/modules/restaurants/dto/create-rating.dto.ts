import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  eventId: number;

  @IsInt()
  @Min(1)
  @Max(5)
  food: number;

  @IsInt()
  @Min(1)
  @Max(5)
  service: number;

  @IsInt()
  @Min(1)
  @Max(5)
  valueRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  noise: number;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  comment?: string;
}
