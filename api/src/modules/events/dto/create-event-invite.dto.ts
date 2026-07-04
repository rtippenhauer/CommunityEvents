import { IsEnum } from 'class-validator';
import { InviteFlavor } from '../../../database/entities/invite.entity';

export class CreateEventInviteDto {
  @IsEnum(InviteFlavor)
  flavor: InviteFlavor = InviteFlavor.NON_VALIDATED;
}
