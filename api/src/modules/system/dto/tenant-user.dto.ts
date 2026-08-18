import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole, UserStatus } from '../../../database/enums';

/**
 * Roles the system admin may hand out inside a community.
 *
 * `system_admin` is absent because it operates the whole deployment, not one
 * community, and admin.service.setRole refuses it for the same reason -- a
 * per-community screen must not be one dropdown away from "operator of all of
 * them". `automation` is absent because it belongs to a service account, which
 * this surface does not touch at all.
 *
 * `non_validated` and `disabled` are reachable, since parking an account
 * without deleting it is exactly what a system admin is here to do.
 */
export const ASSIGNABLE_TENANT_ROLES = [
  UserRole.NON_VALIDATED,
  UserRole.MEMBER,
  UserRole.MODERATOR,
  UserRole.ADMIN,
  UserRole.DISABLED,
] as const;

export class CreateTenantUserDto {
  @IsString()
  @MaxLength(200)
  fullName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  /** Same floor as registration, so an account made here is no weaker. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_TENANT_ROLES)
  role?: (typeof ASSIGNABLE_TENANT_ROLES)[number];
}

export class UpdateTenantUserDto {
  @IsOptional()
  @IsIn(ASSIGNABLE_TENANT_ROLES)
  role?: (typeof ASSIGNABLE_TENANT_ROLES)[number];

  /**
   * `deleted` is deliberately not offered. It is the tombstone the account
   * deletion flow sets, and reaching it from here would look like a delete
   * while leaving the row and its data in place.
   */
  @IsOptional()
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status?: typeof UserStatus.ACTIVE | typeof UserStatus.SUSPENDED;
}

export class ResetTenantUserPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
