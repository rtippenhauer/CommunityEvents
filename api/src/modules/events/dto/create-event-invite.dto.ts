import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { InviteFlavor } from '../../../database/entities/invite.entity';

export class CreateEventInviteDto {
  @IsEnum(InviteFlavor)
  flavor: InviteFlavor = InviteFlavor.NON_VALIDATED;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses: number | null = null;

  @IsInt()
  @Min(1)
  @Max(90)
  expiryDays: number = 30;
}
