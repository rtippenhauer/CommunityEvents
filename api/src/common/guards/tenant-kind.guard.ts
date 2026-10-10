import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantResolutionService } from '../tenant/tenant-resolution.service';

/**
 * Two guards that ask whether the community this request arrived on is a demo
 * (v2-32).
 *
 * ## Why the question has to be asked at all
 *
 * `demo.service` creates the requester of a demo as an **admin** of it, which is
 * correct -- a demo with no admin is a dead end -- but it means "any tenant
 * admin" and "any stranger who filled in the demo form" are the same set of
 * people. Every route that trusts an admin because an admin is a vetted person
 * has to say so explicitly, or it trusts the open internet.
 *
 * That is the lesson v2-14 was rewritten around: the shared demo would have
 * handed the seventh visitor a searchable directory of the previous six
 * visitors' real email addresses, precisely because a demo admin is an admin.
 * `RolesGuard` cannot see this distinction and never will -- it answers what a
 * role may do, not who holds it.
 *
 * ## Why `isDemo` is not on `TenantContext`
 *
 * It could be, and that would make these guards synchronous. It is read through
 * `TenantResolutionService` instead because that is already the one cached
 * answer to "what kind of community is this", shared with `isRootTenant` and
 * `isOnDeploymentDomain`. Adding a second copy to the request object would be a
 * second answer free to disagree with the first -- the same trap `v2-12`'s
 * stored OAuth flag and `v2-13`'s nginx `server_name` each were.
 *
 * Both messages are deliberately uninformative about *why*, matching
 * `SystemAdminGuard` and `RootTenantGuard`: describing the operator surface to
 * somebody who cannot reach it is the disclosure these guards exist to prevent.
 */
@Injectable()
export class NonDemoTenantGuard implements CanActivate {
  constructor(private readonly tenantResolution: TenantResolutionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = request.tenant?.id;

    // No resolved tenant is a refusal, not a pass. These routes are reached
    // through `TenantMiddleware` like every other, so an absent tenant means
    // something upstream is wrong rather than that this is a real community.
    if (tenantId === undefined) {
      throw new ForbiddenException('Not available here.');
    }

    if (await this.tenantResolution.isDemoTenant(tenantId)) {
      throw new ForbiddenException('Not available here.');
    }
    return true;
  }
}

/**
 * The exact complement: this route answers **only** inside a demo.
 *
 * Used for the demo's own feedback form, which is the one thing a demo visitor
 * is specifically being invited to send. A real community reaching it would be
 * filing into the wrong table -- its members have the ordinary feedback board.
 */
@Injectable()
export class DemoTenantGuard implements CanActivate {
  constructor(private readonly tenantResolution: TenantResolutionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = request.tenant?.id;

    if (tenantId === undefined || !(await this.tenantResolution.isDemoTenant(tenantId))) {
      throw new ForbiddenException('Not available here.');
    }
    return true;
  }
}
