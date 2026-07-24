import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateLocationDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  address?: string;

  @ValidateIf((o: UpdateLocationDto) => o.phone !== null)
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string | null;

  @ValidateIf((o: UpdateLocationDto) => o.websiteUrl !== null)
  @IsUrl()
  @MaxLength(500)
  @IsOptional()
  websiteUrl?: string | null;

  @ValidateIf((o: UpdateLocationDto) => o.description !== null)
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

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  @ValidateIf((o: UpdateLocationDto) => o.moderatorNotes !== null)
  @IsString()
  @IsOptional()
  moderatorNotes?: string | null;

  @ValidateIf((o: UpdateLocationDto) => o.contactName !== null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  contactName?: string | null;

  @ValidateIf((o: UpdateLocationDto) => o.contactPhone !== null)
  @IsString()
  @MaxLength(30)
  @IsOptional()
  contactPhone?: string | null;

  @ValidateIf((o: UpdateLocationDto) => o.contactEmail !== null)
  @IsEmail()
  @MaxLength(150)
  @IsOptional()
  contactEmail?: string | null;
}
