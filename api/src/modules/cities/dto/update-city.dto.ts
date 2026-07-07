import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCityDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'subdomain must be lowercase letters, numbers, and hyphens only',
  })
  @IsOptional()
  subdomain?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
