import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
}
