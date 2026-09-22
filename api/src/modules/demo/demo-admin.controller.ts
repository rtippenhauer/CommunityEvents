import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { users as User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { AuditService } from '../audit/audit.service';
import { DemoCapacity, DemoService, PendingDemoRequest } from './demo.service';

/**
 * Demo requests that have not become communities, for the system admin
 * (v2-14).
 *
 * Separate from `DemoController`, which is anonymous by necessity, because the
 * audience is the opposite one -- and mixing a guarded route into a controller
 * whose every other route is public is how a route ends up unguarded later.
 *
 * Mounted under `system/` rather than `admin/` for the reason
 * `TenantsAdminController` is: this reads across the whole deployment rather
 * than inside one community, and `SystemAdminGuard` requires both the role and
 * the root host. Guarded at the class level so a route added here is protected
 * by default.
 *
 * Not under `system/tenants`, though it is rendered on that screen: a request
 * that has not been confirmed has no tenant, which is the entire thing being
 * reported.
 */
@Controller('system/demo-requests')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class DemoAdminController {
  constructor(
    private readonly demoService: DemoService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  list(): Promise<{ capacity: DemoCapacity; requests: PendingDemoRequest[] }> {
    return this.demoService.listPendingRequests();
  }

  /**
   * Withdraws an unconfirmed request and frees its slot.
   *
   * No retyped confirmation, unlike deleting a community: what is destroyed is
   * one row holding a name, an address and a link nobody used, and the person
   * it belonged to can simply ask again. The community delete is awkward on
   * purpose because it destroys somebody's members.
   *
   * Audited on the root tenant, like every other system-admin action --
   * `audit_log` is scoped, and there is no community here to scope it to.
   */
  @Delete(':id')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<PendingDemoRequest> {
    const cancelled = await this.demoService.cancelRequest(id);
    await this.auditService.log({
      userId: user.id,
      action: 'demo.request.cancel',
      entityType: 'demo_request',
      entityId: id,
      // The email, not the name: it is what identifies the request, and the
      // log is the only trace left once the row is gone.
      metadata: { email: cancelled.email, status: cancelled.status },
      ipAddress: req.ip,
    });
    return cancelled;
  }
}
