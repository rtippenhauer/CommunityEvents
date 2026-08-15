import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Deliberately not `PartialType(CreateTenantDto)`.
 *
 * `is_root` is absent from both DTOs, but the reason it is absent differs: on
 * create it is a value the caller must not choose, and on update it is a value
 * nobody may change at all. Writing this class out means the update shape is
 * read directly rather than inferred from another class's omissions.
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

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
