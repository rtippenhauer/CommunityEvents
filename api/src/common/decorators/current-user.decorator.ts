import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserEntity } from '../../database/entities/user.entity';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserEntity => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as UserEntity;
  },
);
