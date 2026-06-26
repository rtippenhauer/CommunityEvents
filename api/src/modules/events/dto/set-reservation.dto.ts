import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class SetReservationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  assigneeId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @ValidateIf((o: SetReservationDto) => o.contactName != null && o.contactName !== '')
  contactEmail?: string | null;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  confirmedNote?: string | null;
}
