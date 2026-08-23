import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { users as User } from '@prisma/client';
import { UserRole } from '../../database/enums';
import { SetTenantSecretDto } from './dto/set-tenant-secret.dto';
import { isTenantSecretKey } from './tenant-secret-keys';
import { TenantSecretsService, type TenantSecretStatus } from './tenant-secrets.service';

/**
 * A community's own third-party credentials (v2-7).
 *
 * Under `admin/` rather than `system/` because these belong to one community
 * and are managed by its own admin — the distinction v2-6 drew when tenant
 * *registry* management went to `system/`. A system admin managing another
 * community's key would go through that registry, and does not today.
 *
 * There is no GET that returns a value, only a listing of which keys are set
 * and where each resolves from. An admin setting a key does not need to read it
 * back, and a credential in a response is a credential in a log, a proxy buffer
 * and a browser cache.
 */
@Controller('admin/secrets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantSecretsController {
  constructor(private readonly secrets: TenantSecretsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  list(): Promise<TenantSecretStatus[]> {
    return this.secrets.list();
  }

  @Put(':key')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  async set(
    @Param('key') key: string,
    @Body() body: SetTenantSecretDto,
    @CurrentUser() actor: User,
  ): Promise<void> {
    // Validated here rather than left to the service: `tenant_secrets` accepts
    // any key by design, so an unrecognised one would save, list as set, and do
    // nothing -- a typo that looks like success.
    if (!isTenantSecretKey(key)) {
      throw new BadRequestException(`Unknown secret key: ${key}`);
    }
    await this.secrets.set(key, body.value, actor.id);
  }

  /** Falls this community back to the deployment-wide value. */
  @Delete(':key')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  async clear(@Param('key') key: string): Promise<void> {
    if (!isTenantSecretKey(key)) {
      throw new BadRequestException(`Unknown secret key: ${key}`);
    }
    await this.secrets.clear(key);
  }
}
