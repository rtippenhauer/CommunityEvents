import { IsInt, IsOptional, IsPositive, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateRestaurantDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(500)
  address: string;

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
  cityId: number;
}
