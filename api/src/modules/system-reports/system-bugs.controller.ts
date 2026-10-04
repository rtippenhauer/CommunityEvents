import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SystemReportsService } from './system-reports.service';
import { CreateSystemBugDto } from './dto/create-system-bug.dto';
import { UpdateSystemBugDto } from './dto/update-system-bug.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { NonDemoTenantGuard } from '../../common/guards/tenant-kind.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * The shared defect board (v2-32).
 *
 * Filed by an admin of any **non-demo** community, read by the admins of every
 * other non-demo community, and triaged only by the system admin on the root
 * tenant. That read-everywhere/write-nowhere split is Rob's (2026-10-04) and is
 * what makes the board worth having: an admin can see a defect is already known
 * instead of filing it again, without being able to edit somebody else's report.
 *
 * ## Why `NonDemoTenantGuard` is on every route and not just the write
 *
 * `demo.service` makes every demo requester an admin, so without it "any tenant
 * admin may read the board" means "anybody who filled in the demo form may read
 * every defect report ever filed, including the free text inside it". Reading is
 * the half that matters here -- a stranger filing noise is a nuisance, a
 * stranger reading other communities' operational detail is the v2-14 failure
 * again.
 *
 * ## Why this is not `/admin/...`
 *
 * It acts on something deployment-wide rather than inside the caller's
 * community, which is the same reason tenant management lives under `system/`.
 */
@Controller('system/bugs')
@UseGuards(JwtAuthGuard, RolesGuard, NonDemoTenantGuard)
export class SystemBugsController {
  constructor(private readonly reports: SystemReportsService) {}

  /**
   * Admins only, deliberately -- not every member.
   *
   * A platform defect reaches the operator through somebody who can already
   * tell a platform defect from a community's own configuration, which keeps
   * the board usable at the volume a deployment of communities produces. A
   * member who finds a bug still has their own community's feedback board, and
   * their admin escalates what belongs here.
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)
  file(@CurrentUser() user: User, @Req() req: Request, @Body() dto: CreateSystemBugDto) {
    return this.reports.fileBug(user, req.tenant!.id, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN)
  list(@CurrentUser() user: User, @Req() req: Request) {
    return this.reports.listBugs({
      tenantId: req.tenant!.id,
      isRootTenant: req.tenant!.isRoot,
      role: user.role,
    });
  }

  /**
   * `SystemAdminGuard` stacks on top of the class guards rather than replacing
   * them: it requires the `system_admin` role **and** the root tenant, which is
   * the "only system admin can interact with it" half of the design.
   */
  @Patch(':id')
  @Roles(UserRole.SYSTEM_ADMIN)
  @UseGuards(SystemAdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSystemBugDto) {
    return this.reports.updateBug(id, dto);
  }
}
