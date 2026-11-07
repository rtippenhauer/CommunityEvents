import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EventStatus } from '../../../database/enums';

export class CreateEventDto {
  /**
   * Optional since `v2-24` made `city_id` nullable: a community with city
   * filtering off has venues with no city at all, and its form renders no
   * city field to fill in.
   *
   * Whether a city is *required* is not a fact about the request, so the DTO
   * cannot decide it -- only `CitiesService.resolveRequiredCityId` knows
   * whether filtering is on, and it refuses a missing city when it is. A
   * `@IsPositive()` that could not be omitted made the notice on the venue
   * form ("this won't belong to a city") describe something the API refused
   * with "cityId must be a positive number".
   */
  @IsInt()
  @IsPositive()
  @IsOptional()
  cityId?: number | null;

  @IsInt()
  @IsPositive()
  locationId: number;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsString()
  @IsOptional()
  additionalInfo?: string | null;

  @IsString()
  @IsOptional()
  facebookShareText?: string | null;

  @IsDateString()
  eventDate: string;

  @Matches(/^\d{2}:\d{2}$/)
  eventTime: string;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;

  @IsBoolean()
  @IsOptional()
  isSecret?: boolean;
}
