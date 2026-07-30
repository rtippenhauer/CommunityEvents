import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class SetMembershipDto {
  @IsBoolean()
  hasMembership: boolean;

  @IsOptional()
  @IsDateString()
  membershipExpiresAt?: string;
}
