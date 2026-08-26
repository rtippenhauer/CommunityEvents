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
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AdminService, AuditLogFilter } from './admin.service';
import { EmailService } from '../email/email.service';
import { EmailDispatcherService } from '../email/email-dispatcher.service';
import { BrevoWebhookService } from '../email/brevo-webhook.service';
import { BrevoService } from '../email/brevo.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetRoleDto } from './dto/set-role.dto';
import { SetMembershipDto } from './dto/set-membership.dto';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { requireTenantId } from '../../common/tenant/tenant-store';
import { newEmailProviderConfig } from '../../common/email/email-config-defaults';
import {
  effectiveEmailConfigView,
  toEmailConfigView,
  type EmailConfigView,
  type EmailQuotaWindowView,
} from './email-config.view';
import { quotaDayStart, resolveQuotaTimeZone } from '../../common/email/quota-day';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly emailService: EmailService,
    private readonly emailDispatcher: EmailDispatcherService,
    private readonly brevoWebhook: BrevoWebhookService,
    private readonly brevo: BrevoService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('users')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getUsers() {
    return this.adminService.getUsers();
  }

  @Post('users/:id/ban')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(200)
  ban(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User) {
    return this.adminService.banUser(id, actor.id, actor.role);
  }

  @Post('users/:id/ban/force')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  forceBan(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User) {
    return this.adminService.forceBanUser(id, actor.id);
  }

  @Post('users/:id/unban')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  unban(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User) {
    return this.adminService.unbanUser(id, actor.id);
  }

  @Delete('users/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  devDelete(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: User,
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
    @CurrentUser() actor: User,
  ) {
    return this.adminService.setRole(id, actor.id, body.role);
  }

  @Post('users/:id/membership')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(200)
  setMembership(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetMembershipDto,
    @CurrentUser() actor: User,
  ) {
    return this.adminService.setMembership(id, actor.id, body.hasMembership, body.membershipExpiresAt);
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
  suppressEmail(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User) {
    return this.adminService.suppressUserEmail(id, actor.id);
  }

  @Delete('users/:id/suppress')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  liftSuppression(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User) {
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

  // Both endpoints answer through toEmailConfigView, which drops the two API
  // keys in favour of booleans. v2-7 encrypts them at rest, and the extension
  // decrypts on read -- so without this the screen would fetch an operator's
  // Brevo key in plaintext on every load, which is the exact exposure the
  // column encryption exists to close.
  // Per-community as of v2-9: `findFirst` with no `where`, so the extension
  // supplies the tenant. It was `findUnique({ id: 1 })` against a single global
  // row, which meant this screen edited every community's sending credentials
  // from whichever community's host the admin happened to be on.
  // Answers for a community with no row too, rather than null. The screen
  // renders nothing without a config, so returning null left a community that
  // had never configured email staring at a spinner on the very screen that
  // creates the row. The row is still written on first save -- a GET does not
  // write.
  @Get('email/config')
  @Roles(UserRole.ADMIN)
  async getEmailConfig(): Promise<EmailConfigView> {
    const config = await this.prisma.email_provider_config.findFirst();
    // requireTenantId rather than the request object, for the same reason raw
    // SQL and the app_config upserts use it: it throws where there is no tenant
    // instead of inventing one.
    return effectiveEmailConfigView(config, requireTenantId('email config read'));
  }

  /**
   * When this community's sending day starts and ends, and what Brevo says is
   * left of it.
   *
   * Separate from the config endpoint because it calls out to Brevo. The screen
   * renders without it and fills it in when it arrives, so an unreachable
   * provider costs a line of the page rather than the page.
   */
  @Get('email/quota-window')
  @Roles(UserRole.ADMIN)
  async getEmailQuotaWindow(): Promise<EmailQuotaWindowView> {
    const { timeZone } = resolveQuotaTimeZone(this.config.get<string>('EMAIL_QUOTA_TIMEZONE'));
    const windowStartedAt = quotaDayStart(new Date(), timeZone);
    // Twenty-six hours past the start always lands inside the next day, which
    // a flat +24h does not: a spring-forward day is 23 hours long and an
    // autumn one 25.
    const windowEndsAt = quotaDayStart(
      new Date(windowStartedAt.getTime() + 26 * 60 * 60 * 1000),
      timeZone,
    );

    const quota = await this.brevo.getAccountQuota();
    return {
      timeZone,
      windowStartedAt: windowStartedAt.toISOString(),
      windowEndsAt: windowEndsAt.toISOString(),
      // Only a daily allowance is comparable with our own counter. A prepaid
      // balance is reported as a plan name and no number rather than as a
      // number that means something else.
      providerRemaining: quota?.isDailyAllowance ? quota.remaining : null,
      providerPlan: quota?.planType ?? null,
    };
  }

  @Patch('email/config')
  @Roles(UserRole.ADMIN)
  async updateEmailConfig(@Body() body: UpdateEmailConfigDto): Promise<EmailConfigView | undefined> {
    const config = await this.prisma.email_provider_config.findFirst();

    // Created on first save rather than returning silently (v2-9). The row used
    // to exist for everyone because seed.ts wrote the one global copy; now it
    // belongs to a community, and a community that has never sent mail has
    // none. Making the admin screen depend on the dispatcher having run first
    // -- which is how the row appeared before -- would mean the settings page
    // silently discarded the first save.
    if (!config) {
      const created = await this.prisma.email_provider_config.create({
        data: { ...newEmailProviderConfig(), ...body },
      });
      return toEmailConfigView(created);
    }
    // Patch from the DTO rather than mutating the loaded row and saving it
    // back, so only the fields the request actually sent are written. That is
    // also what lets the client leave a key alone: an omitted key is undefined
    // and untouched, an explicit null clears it.
    const keyChanged = body.brevoApiKey !== undefined && body.brevoApiKey !== config.brevoApiKey;
    const updated = await this.prisma.email_provider_config.update({
      where: { id: config.id },
      data: { ...body, ...(keyChanged ? { brevoApiKeySetAt: new Date() } : {}) },
    });

    // A changed key may belong to a different Brevo account, where the webhook
    // this community registered does not exist -- so the webhook is re-created
    // with a fresh token rather than left pointing into an account we no longer
    // have a key for. Deliberately not awaited for its success: registration
    // failing must not fail the save that triggered it, or a Brevo outage would
    // stop an operator fixing their own credentials. The outcome is recorded on
    // the row and shown on the screen.
    if (keyChanged) {
      await this.brevoWebhook.register({ newToken: true });
      const refreshed = await this.prisma.email_provider_config.findFirst();
      if (refreshed) return toEmailConfigView(refreshed);
    }

    return toEmailConfigView(updated);
  }

  /**
   * Registers (or re-registers) this community's Brevo webhook.
   *
   * The manual path for the automatic one above: a retry after a failure, or a
   * first registration for a community whose key was set before this existed.
   */
  @Post('email/webhook/register')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  registerBrevoWebhook(): Promise<{ ok: boolean; error?: string }> {
    return this.brevoWebhook.register({ newToken: true });
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
