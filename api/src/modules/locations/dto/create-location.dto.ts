import { IsBoolean, IsEmail, IsInt, IsOptional, IsPositive, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

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

  @IsInt()
  @IsPositive()
  cityId: number;

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
