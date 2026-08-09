import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { InviteType } from '../../../database/enums';

export class CreateInviteDto {
  @IsEnum([InviteType.MEMBER, InviteType.ADMIN, InviteType.CAMPAIGN_FACEBOOK])
  // `typeof` because InviteType is now a const object rather than a TS enum,
  // so its members are values whose types are read through typeof.
  type:
    | typeof InviteType.MEMBER
    | typeof InviteType.ADMIN
    | typeof InviteType.CAMPAIGN_FACEBOOK;

  @IsEmail()
  @MaxLength(255)
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

  @IsInt()
  @Min(2)
  @IsOptional()
  maxUses?: number;

  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  expiryDays?: number;

  @IsBoolean()
  @IsOptional()
  noExpiry?: boolean;
}
