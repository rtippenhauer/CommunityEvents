import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Never throw — just populate req.user if a valid token is present
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<T>(_err: unknown, user: T): T {
    return user; // null when unauthenticated — that's fine
  }
}
