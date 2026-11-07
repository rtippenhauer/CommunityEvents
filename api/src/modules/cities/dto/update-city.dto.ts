import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  name?: string;
}

/**
 * Retiring a city, which is the only way one ever leaves circulation —
 * **a city is never deleted** (Rob, 2026-10-18).
 *
 * `moveToCityId` is required when the community has cities turned on, because
 * with the feature on a city is required for an event, a location and a member
 * to function, so the rows on the retired one have to land somewhere. With the
 * feature off there is nowhere to move them to and nothing that needs one, so
 * they are cleared instead.
 *
 * Deliberately not guarded by the retype-the-name confirmation that deleting a
 * community uses: this is not destructive. Every row keeps its history and
 * every foreign key stays valid.
 */
export class RetireCityDto {
  @IsInt()
  @IsOptional()
  moveToCityId?: number;
}
