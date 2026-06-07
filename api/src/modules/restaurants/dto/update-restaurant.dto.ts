import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateRestaurantDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  address?: string;

  @ValidateIf((o: UpdateRestaurantDto) => o.phone !== null)
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string | null;

  @ValidateIf((o: UpdateRestaurantDto) => o.websiteUrl !== null)
  @IsUrl()
  @IsOptional()
  websiteUrl?: string | null;

  @ValidateIf((o: UpdateRestaurantDto) => o.description !== null)
  @IsString()
  @IsOptional()
  description?: string | null;

  @IsInt()
  @IsPositive()
  @IsOptional()
  cityId?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
