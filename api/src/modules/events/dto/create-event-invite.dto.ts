import { IsEnum } from 'class-validator';
import { InviteFlavor } from '../../../database/enums';

export class CreateEventInviteDto {
  @IsEnum(InviteFlavor)
  flavor: InviteFlavor = InviteFlavor.NON_VALIDATED;
}
