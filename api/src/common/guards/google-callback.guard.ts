import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

const REASON_MAP: Record<string, string> = {
  'An invite is required to create an account': 'no_invite',
  'Account not active': 'not_active',
  'Invite not found': 'invalid_invite',
  'Invite has already been used': 'invite_used',
  'Invite has expired': 'invite_expired',
  'This invite was sent to a different email address': 'invite_email_mismatch',
};

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  handleRequest<T>(err: Error | null, user: T, _info: unknown, ctx: ExecutionContext): T {
    if (err || !user) {
      const req = ctx.switchToHttp().getRequest<{ authErrorReason?: string }>();
      const msg = err?.message ?? '';
      req.authErrorReason = REASON_MAP[msg] ?? 'unknown';
    }
    return user ?? (null as T);
  }
}
