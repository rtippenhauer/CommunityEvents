import { IsIn } from 'class-validator';
import { UserRole } from '../../../database/enums';

/**
 * Which automation an integration account is acting as (v2-29).
 *
 * Only the two integration roles are accepted. This is deliberately not
 * `admin.service.setRole`, which takes any `UserRole` and therefore carries
 * the whole `system_admin` escalation argument with it: an endpoint that
 * cannot express a third role has no escalation path to reason about.
 */
export const INTEGRATION_ROLES = [UserRole.MUSE, UserRole.AUTOMATION] as const;

export class SetIntegrationRoleDto {
  @IsIn(INTEGRATION_ROLES as readonly string[])
  role!: (typeof INTEGRATION_ROLES)[number];
}
