import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RootTenantGuard } from '../../common/guards/root-tenant.guard';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * The release-note system, which is **deployment-wide**.
 *
 * `releases` and `release_feedback` are in `GLOBAL_MODELS`, so the scoping
 * extension deliberately leaves them alone -- there is one set of release notes
 * for the whole installation, not one per community.
 *
 * **`RootTenantGuard` is class-level and load-bearing.** Every route here was
 * `@Roles(ADMIN)` alone, which is a role check with no "where": the admin of
 * any community could read drafts, edit, publish and unpublish the notes the
 * entire deployment sees. That is the same shape as `/admin/email` before v2-9
 * (one global row any community's admin could rewrite) and the `cities`
 * controller still open against v2-24. Found by review, 2026-10-02.
 *
 * The per-route `@Roles(...)` sets below are unchanged on purpose: they encode a
 * deliberate policy about what the automation account may do (draft and
 * unpublish, never publish). What was missing was the community, not the role,
 * so the fix adds the community rather than re-litigating the roles.
 */
@Controller('admin/releases')
@UseGuards(JwtAuthGuard, RootTenantGuard)
export class ReleasesAdminController {
  constructor(private readonly releasesService: ReleasesService) {}

  // Read-only listing is automation-accessible so Claude can check what's
  // published/drafted without needing Rob to elevate its role first — the
  // role-picker elevation is reserved for browsing role-gated pages that
  // aren't otherwise automation-scoped.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AUTOMATION)
  findAll() {
    return this.releasesService.findAll();
  }

  @Get('resolved-feedback')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getResolvedFeedback() {
    return this.releasesService.getResolvedFeedback();
  }

  /**
   * Bugs & requests an operator may credit on a release (v2-43).
   *
   * `OperatorGuard` rather than `@Roles(ADMIN)` alone: `system_reports` is the
   * shared board across every community, so this is the operator's list, not
   * any one community admin's -- and the guard keys on `is_service_account`,
   * never on the role, which is deliberately flipped for testing.
   */
  @Get('report-candidates')
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.AUTOMATION)
  @UseGuards(OperatorGuard)
  getReportCandidates() {
    return this.releasesService.getReportCandidates();
  }

  @Post(':id/reports/:reportId')
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.AUTOMATION)
  @UseGuards(OperatorGuard)
  @HttpCode(204)
  async linkReport(
    @Param('id', ParseIntPipe) id: number,
    @Param('reportId', ParseIntPipe) reportId: number,
  ): Promise<void> {
    await this.releasesService.linkReport(id, reportId);
  }

  @Delete('reports/:reportId')
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.AUTOMATION)
  @UseGuards(OperatorGuard)
  @HttpCode(204)
  async unlinkReport(@Param('reportId', ParseIntPipe) reportId: number): Promise<void> {
    await this.releasesService.unlinkReport(reportId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.findOneAdmin(id);
  }

  // Draft creation and unpublish are automation-enabled, via the dedicated
  // automation account's own login (see AuthService.automationLogin).
  // Editing and publishing stay human/browser-session-only — per CLAUDE.md,
  // publishing is always a manual, separate action, never done by Claude.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AUTOMATION)
  create(@Body() dto: CreateReleaseDto, @CurrentUser() user: User) {
    return this.releasesService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReleaseDto) {
    return this.releasesService.update(id, dto);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.publish(id);
  }

  @Post(':id/unpublish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AUTOMATION)
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.unpublish(id);
  }
}
