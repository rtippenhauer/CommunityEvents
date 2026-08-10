import { IsIn } from 'class-validator';
import { UserRole } from '../../../database/enums';

export class SetRoleDto {
  @IsIn(Object.values(UserRole))
  role: UserRole;
}
