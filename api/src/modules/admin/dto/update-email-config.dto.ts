import {
  IsBoolean, IsEmail, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, Min,
} from 'class-validator';

export class UpdateEmailConfigDto {
  @IsBoolean()
  @IsOptional()
  brevoEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  resendOverflowEnabled?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  brevoDailyLimit?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  resendDailyLimit?: number;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  brevoApiKey?: string | null;

  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  brevoFromEmail?: string | null;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  brevoFromName?: string | null;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  resendApiKey?: string | null;

  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  resendFromEmail?: string | null;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  resendFromName?: string | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplInvite?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplSecurityAlert?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplEventPublished?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplRsvpConfirmation?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplEventReminder?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplAccountDeletion?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplReengagement60?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplReengagement90?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplGuestRsvpConfirmation?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplEmailVerification?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplPasswordReset?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplProviderDisconnected?: number | null;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  @IsOptional()
  tmplAccountDeleted?: number | null;
}
