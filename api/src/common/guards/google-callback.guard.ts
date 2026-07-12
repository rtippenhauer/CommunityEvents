import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      const res = context.switchToHttp().getResponse<Response>();
      const frontendUrl = this.config.get<string>('APP_URL', 'http://localhost:8081');

      let reason = 'unknown';
      let email: string | undefined;

      const e = err as Error & { reason?: string; boundEmail?: string };
      if (e?.name === 'AuthFlowError') {
        reason = e.reason ?? 'unknown';
        email = e.boundEmail;
      }

      const params = new URLSearchParams({ reason });
      if (email) params.set('email', email);
      res.redirect(`${frontendUrl}/auth/error?${params.toString()}`);
      return true; // allow controller to run; it checks res.headersSent and returns immediately
    }
  }
}
