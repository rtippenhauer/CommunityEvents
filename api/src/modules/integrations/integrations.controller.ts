import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { users as User } from '@prisma/client';
import { UserRole } from '../../database/enums';
import { CreateIntegrationAccountDto } from './dto/create-integration-account.dto';
import { IntegrationsService, type IntegrationAccountView } from './integrations.service';
import type { IssuedToken } from './api-token.service';

/**
 * A community's own integration accounts and their tokens (v2-29).
 *
 * Under `admin/` rather than `system/` because these belong to one community
 * and are managed by its own admin -- the same split `v2-7`'s secrets screen
 * drew, and the one `v2-6` established when the tenant *registry* moved to
 * `system/`. It is also what makes per-community Muse work without the operator
 * involved: a community's admin creates their own integration account, issues
 * their own token, and points their own Muse at it.
 *
 * The plaintext token is returned by exactly two routes, both of which mint it,
 * and by no GET. There is no way to read an existing token back -- only its
 * prefix and whether it is live. A credential in a GET response is a credential
 * in an access log, a proxy buffer and a browser cache, which is the rule
 * `v2-7` set when `GET /admin/email/config` stopped returning the Brevo key.
 */
@Controller('admin/integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  list(): Promise<IntegrationAccountView[]> {
    return this.integrations.listAccounts();
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Body() body: CreateIntegrationAccountDto,
    @CurrentUser() actor: User,
  ): Promise<IntegrationAccountView> {
    return this.integrations.createAccount(body.name, actor.id);
  }

  /**
   * Mints a token and returns it once.
   *
   * POST rather than GET even though it reads like "get me a token", because it
   * writes: it creates a row and revokes every other live one for that account.
   */
  @Post(':userId/tokens')
  @Roles(UserRole.ADMIN)
  issueToken(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() actor: User,
  ): Promise<IssuedToken> {
    return this.integrations.issueToken(userId, actor.id);
  }

  @Delete('tokens/:tokenId')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  revokeToken(
    @Param('tokenId', ParseIntPipe) tokenId: number,
    @CurrentUser() actor: User,
  ): Promise<void> {
    return this.integrations.revokeToken(tokenId, actor.id);
  }
}
