import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTenantDto {
  /**
   * The host this community answers on. Normalised (lower-cased, `www.`
   * stripped, port dropped) by the service before it is stored, so what is
   * accepted here is deliberately loose -- the strict rule is that it must
   * survive normalisation into something with a dot in it.
   */
  @IsString()
  @MaxLength(255)
  domain: string;

  /**
   * Short stable handle. Defaults to the first label of the domain when
   * omitted, matching provision-tenant.ts.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,50}$/, {
    message: 'slug must be 1-50 characters of a-z, 0-9 or "-"',
  })
  slug?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  /**
   * The new community's first admin.
   *
   * Optional only so an operator can stage a tenant before deciding who runs
   * it. Leaving it out produces a community nobody can sign in to: registration
   * requires an invite, invites must be issued by an existing member of that
   * tenant, and the only other account is its `disabled` service account. The
   * UI therefore asks for it up front and warns when it is omitted.
   *
   * REQ-TENANT-01 has no opinion on this; it emerged from the first two-tenant
   * test on stage, where a freshly created community turned out to be a
   * dead end.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  adminName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  adminEmail?: string;

  /**
   * Same floor the registration DTO enforces, so an account created here cannot
   * be weaker than one the owner would have chosen themselves.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  adminPassword?: string;

  /**
   * The domain the new community sends mail from, stored as its `mail_domain`
   * setting.
   *
   * Asked here rather than left to Settings because the operator creating the
   * community is the only person who knows the DNS behind it, and because the
   * consequence of getting it wrong is invisible: mail from a domain with no MX
   * record bounces silently. Blank means "inherit the deployment's", which is
   * the right answer for a community on a subdomain of the deployment's own
   * apex -- and is what the dialog suggests for exactly that case.
   *
   * Create-only, like the admin fields above. Afterwards it belongs to that
   * community's own Settings page, where its admin can see it beside the other
   * addresses derived from it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mailDomain?: string;
}
