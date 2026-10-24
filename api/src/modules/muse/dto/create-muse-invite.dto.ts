import { IsIn, IsOptional } from 'class-validator';
import { InviteFlavor } from '../../../database/enums';

export class CreateMuseInviteDto {
  /**
   * `member` grants full membership; `non_validated` requires a moderator to
   * validate the person afterwards.
   *
   * **Defaults to `non_validated`**, which is the contract's default and the
   * safe one: these links get posted publicly in a Facebook group, so the
   * default has to be the flavour where a stranger redeeming one still needs a
   * human to approve them. Defaulting to `member` would turn a mis-shaped
   * request into open membership.
   */
  @IsOptional()
  @IsIn([InviteFlavor.MEMBER, InviteFlavor.NON_VALIDATED])
  flavor?: string;
}
