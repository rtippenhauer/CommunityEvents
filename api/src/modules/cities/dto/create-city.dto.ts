import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCityDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'subdomain must be lowercase letters, numbers, and hyphens only',
  })
  subdomain: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
