import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCityDto {
  // `subdomain` went with v2-24: a city is a row, not a hostname. Nothing
  // replaces it — the name is the whole identity now, unique within the
  // community rather than across the deployment.
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
