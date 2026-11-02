import { IsBoolean, IsEmail, IsInt, IsOptional, IsPositive, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  @IsBoolean()
  @IsOptional()
  isResidence?: boolean;

  @IsString()
  @MaxLength(500)
  address: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsUrl()
  @MaxLength(500)
  @IsOptional()
  websiteUrl?: string;

  @IsString()
  @IsOptional()
  description?: string;

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

  @IsString()
  @IsOptional()
  moderatorNotes?: string | null;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  contactName?: string | null;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  contactPhone?: string | null;

  @IsEmail()
  @MaxLength(150)
  @IsOptional()
  contactEmail?: string | null;
}
