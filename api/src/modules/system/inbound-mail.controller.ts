import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/enums';
import { InboundEmailLogService } from '../email/inbound-email-log.service';
import { InboundEmailLogQueryDto } from '../email/dto/inbound-email-log-query.dto';

/**
 * The operator's view of inbound mail (v2-34).
 *
 * Under `system/` rather than `admin/` for the reason tenant management is: it
 * acts across the registry of communities rather than inside one. The
 * per-community half is `GET /admin/email/inbound`, and the two are different
 * *methods* on the service rather than one method with a filter — see
 * `InboundEmailLogService`.
 *
 * ## "Every row" is literal
 *
 * This returns rows belonging to a community **and rows belonging to none**,
 * which is the point of the view rather than an exception to it. A message that
 * resolved to no community is simultaneously the most valuable row on the
 * screen and the only row the per-community read can never return, so a filter
 * here would leave the log blind exactly where it was built to see. There is no
 * `tenantId` predicate at all, deliberately.
 *
 * `?unresolvedOnly=true` narrows to those rows, which is the first thing to
 * look at when a reply has gone astray.
 *
 * ## Why `OperatorGuard` and not `@Roles(SYSTEM_ADMIN)`
 *
 * It requires the root tenant **and** either `system_admin` or the service
 * account column — never the role alone, because the automation account's role
 * is deliberately flipped for testing and a role check locks it out exactly
 * when automation is being used. v2-32 got this wrong twice, and the second
 * attempt reached stage.
 *
 * `source_ip` is served here and withheld from the per-community read: it is a
 * property of whoever is talking to the deployment, not of the community whose
 * address they happened to name.
 */
@Controller('system/email')
@UseGuards(JwtAuthGuard, RolesGuard, OperatorGuard)
@Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.AUTOMATION)
export class InboundMailController {
  constructor(private readonly inboundLog: InboundEmailLogService) {}

  @Get('inbound')
  list(@Query() query: InboundEmailLogQueryDto) {
    return this.inboundLog.listAll(query);
  }

  /**
   * One message's stored body, from any community or none.
   *
   * `null` for the tenant is what lets this open a row the per-community read
   * cannot see, and it is the whole difference between the two callers.
   */
  @Get('inbound/:id')
  async body(@Param('id', ParseIntPipe) id: number) {
    const body = await this.inboundLog.getBody(id, null);
    if (!body) throw new NotFoundException('No such inbound message');
    return body;
  }
}
