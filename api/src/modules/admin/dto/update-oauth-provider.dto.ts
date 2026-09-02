import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';

/**
 * Sets or clears one provider's app credentials for the requesting community.
 *
 * **An omitted `clientId` means "switch this provider off", not "leave it
 * alone".** That is the opposite of the email config's convention, and
 * deliberately so: there are exactly two fields and they are meaningless apart,
 * so a partial update has no coherent meaning here. Clearing has to be
 * expressible, and a screen with one Save button per provider should not need a
 * separate Delete route to express it.
 *
 * The secret is therefore required whenever an id is present -- see
 * `OAuthConfigController.setGoogle` for why a half-configured provider is worse
 * than a switched-off one.
 */
export class UpdateOAuthProviderDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  clientId?: string;

  @ValidateIf((dto: UpdateOAuthProviderDto) => !!dto.clientId)
  @IsString()
  @Length(1, 512)
  clientSecret?: string;
}
