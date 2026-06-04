import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { InviteType } from '../../../database/entities/invite.entity';

export class CreateInviteDto {
  @IsEnum([InviteType.MEMBER, InviteType.ADMIN, InviteType.CAMPAIGN_FACEBOOK])
  type: InviteType.MEMBER | InviteType.ADMIN | InviteType.CAMPAIGN_FACEBOOK;

  @IsEmail()
  @IsOptional()
  boundToEmail?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  boundToName?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  cityId?: number;

  @IsInt()
  @IsPositive()
  @IsOptional()
  facebookGroupId?: number;
}
