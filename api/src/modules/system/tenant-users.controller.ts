import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { users as User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import {
  CreateTenantUserDto,
  ResetTenantUserPasswordDto,
  UpdateTenantUserDto,
} from './dto/tenant-user.dto';
import { TenantUsersService } from './tenant-users.service';

/**
 * The people inside one community, administered from the root tenant.
 *
 * Nested under the tenant it acts on so the community is part of the route
 * rather than a field in the body -- a request cannot reach a user without
 * naming which community it means, and the service filters by that id.
 *
 * Guarded at the class level like its sibling controller, so a route added
 * later is protected by default rather than by remembering.
 */
@Controller('system/tenants/:tenantId/users')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class TenantUsersController {
  constructor(private readonly tenantUsers: TenantUsersService) {}

  @Get()
  findAll(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.tenantUsers.findAll(tenantId);
  }

  @Post()
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateTenantUserDto,
    @CurrentUser() user: User,
  ) {
    return this.tenantUsers.create(tenantId, dto, user.id);
  }

  @Patch(':userId')
  update(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateTenantUserDto,
    @CurrentUser() user: User,
  ) {
    return this.tenantUsers.update(tenantId, userId, dto, user.id);
  }

  @Post(':userId/password')
  resetPassword(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ResetTenantUserPasswordDto,
    @CurrentUser() user: User,
  ) {
    return this.tenantUsers.resetPassword(tenantId, userId, dto, user.id);
  }
}
