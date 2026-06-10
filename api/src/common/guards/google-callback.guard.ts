import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthFlowError } from '../errors/auth-flow.error';

const REASON_MAP: Record<string, string> = {
  'An invite is required to create an account': 'no_invite',
  'No email from Google': 'no_invite',
  'Account not active': 'not_active',
  'Invalid invite link': 'invalid_invite',
  'This invite has already been used': 'invite_used',
  'This invite has expired': 'invite_expired',
  'This invite has been revoked': 'invite_used',
};

export interface AuthErrorRequest {
  authErrorReason?: string;
  authErrorEmail?: string;
}

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  handleRequest<T>(err: Error | null, user: T, _info: unknown, ctx: ExecutionContext): T {
    if (err || !user) {
      const req = ctx.switchToHttp().getRequest<AuthErrorRequest>();

      if (err instanceof AuthFlowError || err?.name === 'AuthFlowError') {
        const authErr = err as AuthFlowError;
        req.authErrorReason = authErr.reason;
        if (authErr.boundEmail) req.authErrorEmail = authErr.boundEmail;
      } else {
        const msg = err?.message ?? '';
        req.authErrorReason = REASON_MAP[msg] ?? 'unknown';
      }
    }
    return user ?? (null as T);
  }
}
