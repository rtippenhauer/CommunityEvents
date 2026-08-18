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
import type { users as User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { DeleteTenantDto } from './dto/delete-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsAdminService } from './tenants-admin.service';

/**
 * Tenant management for the system admin (REQ-TENANT-01.7).
 *
 * Mounted under `system/` rather than the existing `admin/` prefix because the
 * audience is different in kind: every `admin/` route acts within one community
 * and is reachable by that community's admin, whereas everything here acts on
 * the registry of communities and is reachable only from the root tenant. The
 * separate prefix keeps that from being a per-route detail someone has to
 * notice.
 *
 * Guarded at the class level, so a route added here is protected by default --
 * the opposite of the per-method @Roles() pattern used elsewhere, where the
 * cost of forgetting is exposing one endpoint. SystemAdminGuard checks both the
 * role and that the request resolved to the root tenant.
 *
 * Delete exists but is deliberately awkward to reach: a community must already
 * be suspended, and the caller retypes its domain. Suspending is still the
 * right way to take one offline -- it is instant and reversible, and deleting
 * removes every row of the 29 scoped models that reference the tenant.
 */
@Controller('system/tenants')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class TenantsAdminController {
  constructor(private readonly tenantsService: TenantsAdminService) {}

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tenantsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTenantDto, @CurrentUser() user: User) {
    return this.tenantsService.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: User,
  ) {
    return this.tenantsService.update(id, dto, user.id);
  }

  /**
   * DELETE with a body, which is unusual enough to say why: the confirmation is
   * the domain being deleted, and putting it in the query string would write it
   * into access logs and browser history for an action whose whole point is
   * that it was typed deliberately once.
   */
  @Delete(':id')
  @HttpCode(200)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeleteTenantDto,
    @CurrentUser() user: User,
  ) {
    return this.tenantsService.remove(id, dto, user.id);
  }
}
