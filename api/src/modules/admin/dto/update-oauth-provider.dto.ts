import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';

/**
 * Trims a pasted credential, and turns a field left as whitespace into an
 * absence rather than a one-space credential.
 *
 * Both halves matter. A trailing newline survives a copy out of a provider
 * console, is invisible in the field and in the console it came from, and is
 * sent to the provider verbatim -- which fails as `invalid_client`, naming
 * nothing. And `clientId: ' '` would otherwise be a truthy id, so `clearing`
 * reads false and the DTO demands a secret for a credential that is blank.
 */
const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

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
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @Length(1, 255)
  clientId?: string;

  @Transform(trimmed)
  @ValidateIf((dto: UpdateOAuthProviderDto) => !!dto.clientId)
  @IsString()
  @Length(1, 512)
  clientSecret?: string;
}
