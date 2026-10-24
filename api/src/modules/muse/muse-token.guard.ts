import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTokenService } from '../integrations/api-token.service';

/**
 * The only way into a `/muse` route (v2-29).
 *
 * Four conditions, all checked in `ApiTokenService.verify` and all of which
 * `MuseTenantMiddleware` has already run by the time this executes: the token
 * exists, it is unrevoked and unexpired, its account is `active`, and that
 * account currently holds the `muse` role.
 *
 * **A session cookie does not open these routes and a token opens nothing
 * else.** Both halves matter. Muse's account cannot hold a session at all
 * (`password_hash` is NULL and both login and reset refuse a NULL hash), and
 * this guard ignores `req.user` entirely, so no amount of being signed in
 * reaches a Muse route. In the other direction the token is read only by the
 * middleware mounted on this prefix, so presenting it to any other endpoint
 * authenticates nothing -- which is what keeps a Muse token away from
 * `OperatorGuard`, the one place `is_service_account` grants deployment-wide
 * rights.
 *
 * **The role is required as currently held**, matching v1: switching the
 * account to `automation` for testing disables its token until it is switched
 * back. That is the intended off switch, not a side effect of the check.
 *
 * One 401 for every failure. The specific reason is logged where only the
 * operator can read it -- telling a caller "expired" rather than "no such
 * token" confirms that a token it holds was once real.
 */
@Injectable()
export class MuseTokenGuard implements CanActivate {
  constructor(private readonly tokens: ApiTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const verified = request.museToken;

    if (verified === undefined) {
      throw new UnauthorizedException('A valid integration token is required.');
    }

    // Stamped here rather than in the middleware so it records a call that was
    // actually authorised. Fire-and-forget: it must never fail the request.
    this.tokens.touch(verified.tokenId);

    return true;
  }
}
