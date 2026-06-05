import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
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

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsUrl()
  @IsOptional()
  websiteUrl?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  cityId?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
