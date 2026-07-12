import { IsIn } from 'class-validator';
import { UserRole } from '../../../database/entities/user.entity';

export class SetRoleDto {
  @IsIn(Object.values(UserRole))
  role: UserRole;
}
