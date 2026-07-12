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
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminService, AuditLogFilter } from './admin.service';
import { EmailService } from '../email/email.service';
import { EmailDispatcherService } from '../email/email-dispatcher.service';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { SetRoleDto } from './dto/set-role.dto';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly emailService: EmailService,
    private readonly emailDispatcher: EmailDispatcherService,
    @InjectRepository(EmailProviderConfigEntity)
    private readonly providerConfigRepo: Repository<EmailProviderConfigEntity>,
  ) {}

  @Get('users')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
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
  unban(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: UserEntity) {
    return this.adminService.unbanUser(id, actor.id);
  }

  @Delete('users/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  devDelete(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: UserEntity,
  ) {
    return this.adminService.devDeleteUser(id, actor.id);
  }

  @Post('users/:id/role')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetRoleDto,
    @CurrentUser() actor: UserEntity,
  ) {
    return this.adminService.setRole(id, actor.id, body.role);
  }

  @Get('users/:id/email-suppressed')
  @Roles(UserRole.ADMIN)
  async getEmailSuppressed(@Param('id', ParseIntPipe) id: number) {
    const suppressed = await this.adminService.isEmailSuppressed(id);
    return { suppressed };
  }

  @Post('users/:id/suppress')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  suppressEmail(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: UserEntity) {
    return this.adminService.suppressUserEmail(id, actor.id);
  }

  @Delete('users/:id/suppress')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  liftSuppression(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: UserEntity) {
    return this.adminService.liftEmailSuppression(id, actor.id);
  }

  @Get('audit')
  @Roles(UserRole.ADMIN)
  getAuditLog(
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('userSearch') userSearch?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filter: AuditLogFilter = {
      action: action || undefined,
      userId: userId ? parseInt(userId, 10) : undefined,
      userSearch: userSearch || undefined,
      entityType: entityType || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    };
    return this.adminService.getAuditLog(filter);
  }

  @Get('invites/lineage')
  @Roles(UserRole.ADMIN)
  getInviteLineage() {
    return this.adminService.getInviteLineage();
  }

  @Get('email/queue')
  @Roles(UserRole.ADMIN)
  getEmailQueue() {
    return this.emailService.getQueue();
  }

  @Get('email/config')
  @Roles(UserRole.ADMIN)
  async getEmailConfig() {
    return this.providerConfigRepo.findOne({ where: { id: 1 } });
  }

  @Patch('email/config')
  @Roles(UserRole.ADMIN)
  async updateEmailConfig(@Body() body: UpdateEmailConfigDto) {
    const config = await this.providerConfigRepo.findOne({ where: { id: 1 } });
    if (!config) return;
    Object.assign(config, body);
    return this.providerConfigRepo.save(config);
  }

  @Post('email/flush')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  async flushQueue() {
    await this.emailDispatcher.dispatchPending();
    return { ok: true };
  }

  @Post('email/retry-failed')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  async retryFailed() {
    const count = await this.emailService.retryFailed();
    return { retried: count };
  }

  @Delete('email/:id')
  @Roles(UserRole.ADMIN)
  cancelEmail(@Param('id', ParseIntPipe) id: number) {
    return this.emailService.cancelEmail(id);
  }
}
