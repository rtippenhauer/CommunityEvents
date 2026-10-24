import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class MuseLocationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId?: number;

  /** Matches on the name. Both parameters are optional. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
