import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  emailInvite?: boolean;

  @IsOptional()
  @IsBoolean()
  emailVerification?: boolean;

  @IsOptional()
  @IsBoolean()
  emailPasswordReset?: boolean;

  @IsOptional()
  @IsBoolean()
  emailPasswordChanged?: boolean;

  @IsOptional()
  @IsBoolean()
  emailSecurityAlert?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEventPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  emailRsvpConfirmation?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEventReminder?: boolean;

  @IsOptional()
  @IsBoolean()
  emailAccountDeletion?: boolean;

  @IsOptional()
  @IsBoolean()
  emailReengagement?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEventPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEventReminder?: boolean;

  @IsOptional()
  @IsBoolean()
  pushAnnouncement?: boolean;
}
