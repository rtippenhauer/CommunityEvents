import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @Roles(UserRole.ADMIN)
  getUsers() {
    return this.adminService.getUsers();
  }

  @Post('users/:id/ban')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(200)
  ban(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: UserEntity) {
    return this.adminService.banUser(id, actor.id, actor.role);
  }

  @Post('users/:id/ban/force')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  forceBan(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: UserEntity) {
    return this.adminService.forceBanUser(id, actor.id);
  }

  @Post('users/:id/unban')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  unban(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.unbanUser(id);
  }

  @Post('users/:id/role')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body('role') role: UserRole,
    @CurrentUser() actor: UserEntity,
  ) {
    return this.adminService.setRole(id, actor.id, role);
  }
}
