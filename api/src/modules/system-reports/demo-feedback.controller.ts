import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SystemReportsService } from './system-reports.service';
import { CreateDemoFeedbackDto } from './dto/create-demo-feedback.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DemoTenantGuard } from '../../common/guards/tenant-kind.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * What a demo visitor thought (v2-32, Rob 2026-10-04).
 *
 * Submitted from inside a demo by its own admin -- who *is* the visitor -- and
 * read back by them and by the operator. Never by another community: this is
 * the opposite audience from the bug board next door, which is why the two are
 * separate tables and separate controllers rather than one with a flag.
 *
 * ## The reason it is worth a table of its own
 *
 * A demo is deleted after seven days or 48 idle hours, and `purgeTenantRows`
 * erases every scoped row with it. Written into the ordinary `feedback` table,
 * a visitor's verdict on the product would survive exactly as long as the trial
 * that produced it and then be destroyed -- readable only while the visitor was
 * still in front of it, and gone by the time anybody wanted to act on it.
 *
 * ## The follow-up survey is not here
 *
 * Rob wants a survey mailed before or just after a demo is deleted. That is a
 * later phase and needs its own retention decision, because mailing somebody
 * later means keeping an address past the demo and past `demo_requests`' own
 * seven-day window. Nothing here stores one. Worth knowing when it is built:
 * the send has to happen from outside the demo, since `sendingIsBlocked()`
 * refuses mail on `is_demo` -- which is exactly how the confirmation mail
 * already works, being sent before the demo exists.
 */
@Controller('demo/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DemoFeedbackController {
  constructor(private readonly reports: SystemReportsService) {}

  /**
   * `DemoTenantGuard` rather than the non-demo one: this is the single route in
   * the application that answers *only* inside a demo.
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @UseGuards(DemoTenantGuard)
  async submit(@CurrentUser() user: User, @Req() req: Request, @Body() dto: CreateDemoFeedbackDto) {
    /**
     * The demo's own host label, not its brand name (Rob, 2026-10-09).
     *
     * This read `brand_name`, and every demo is seeded from one fixture -- so
     * the column held "Riverside Community Events" on every row and identified
     * the template rather than the visit. The slug is the generated subdomain,
     * which is unique per demo.
     *
     * The address rides along because it is the only way to reply once the
     * demo is purged, and because the slug says which demo without saying who.
     */
    return this.reports.submitDemoFeedback(
      user,
      req.tenant!.id,
      req.tenant!.slug.slice(0, 120),
      dto,
    );
  }

  /**
   * Deliberately *not* `DemoTenantGuard`: the operator reads this from the root
   * tenant, where it is the only place every demo's verdict can be seen at
   * once. The service decides what each of them gets -- a demo's admin sees
   * their own demo's, the operator sees all of them.
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)
  list(@CurrentUser() user: User, @Req() req: Request) {
    return this.reports.listDemoFeedback({
      tenantId: req.tenant!.id,
      isRootTenant: req.tenant!.isRoot,
      role: user.role,
      // The column, not the role: the service account is flipped between roles
      // for testing, so a role check fails exactly when automation is in use.
      isServiceAccount: user.isServiceAccount,
    });
  }
}
