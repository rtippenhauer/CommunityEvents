import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminService } from './admin.service';
import { EmailService } from '../email/email.service';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly emailService: EmailService,
    @InjectRepository(EmailProviderConfigEntity)
    private readonly providerConfigRepo: Repository<EmailProviderConfigEntity>,
  ) {}

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
  setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body('role') role: UserRole,
    @CurrentUser() actor: UserEntity,
  ) {
    return this.adminService.setRole(id, actor.id, role);
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
  async updateEmailConfig(@Body() body: Partial<EmailProviderConfigEntity>) {
    const config = await this.providerConfigRepo.findOne({ where: { id: 1 } });
    if (!config) return;
    Object.assign(config, body);
    return this.providerConfigRepo.save(config);
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
