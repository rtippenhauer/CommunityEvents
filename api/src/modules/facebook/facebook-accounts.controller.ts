import {
  Body,
  Controller,
  Logger,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { users as User } from '@prisma/client';
import { UserRole } from '../../database/enums';
import { FacebookAccountsService, type FacebookAccountView } from './facebook-accounts.service';
import { FacebookSyncService } from './facebook-sync.service';
import { LinkFacebookAccountDto } from './dto/link-facebook-account.dto';
import { FacebookAccountsQueryDto } from './dto/facebook-accounts-query.dto';
import { MarkFacebookAttendanceDto } from './dto/mark-facebook-attendance.dto';

/**
 * Admin → Security → Facebook Accounts (v2-29).
 *
 * The screen where a Facebook person is tied to a member. **This is the only
 * place linking happens** -- rule 5 makes matching a human decision, and the
 * server only ever suggests. The sync records who it saw and never links
 * anybody, so without this screen the whole feature is unreachable: every
 * Facebook person stays unmatched for ever and no member is ever marked Going.
 *
 * `v2-43` is the cautionary tale. v2-32 built credit as a link, the read path
 * rendered it, and no screen ever wrote one -- so the feature looked finished
 * and was unusable by a human. The equivalent omission here is this controller.
 *
 * Under `admin/`, and `@Roles(ADMIN, MODERATOR)` throughout: these are one
 * community's own links, made by the people who run its dinners.
 *
 * `v2-29` gated linking at `admin` on the grounds that a wrong link marks the
 * wrong member Going and emails them a confirmation. **Overruled by Rob,
 * 2026-11-01**, and the reasoning it replaces is worth keeping: the risk is
 * real but it is a *mistake*, not an escalation — it is visible on the screen,
 * reversible from the same screen, and audited with the actor. What the gate
 * actually cost was the common case, since the moderator marking attendance at
 * the dinner is the person who knows which Facebook name is which member, and
 * sending them to find an admin is how a queue stops being worked.
 *
 * **Every route moves together, which is the part that is not negotiable.**
 * `list` or the triage routes left at `admin` would give a moderator a screen
 * they cannot read, or a link they cannot undo — and a role that can make a
 * wrong link but not reverse it is strictly worse than one that cannot make it.
 * `attendance` was already `ADMIN, MODERATOR`.
 */
@Controller('admin/facebook-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacebookAccountsController {
  private readonly logger = new Logger(FacebookAccountsController.name);

  constructor(
    private readonly accounts: FacebookAccountsService,
    private readonly sync: FacebookSyncService,
  ) {}

  /**
   * The review queue, filterable by status.
   *
   * No filter returns everything, which is what makes "has this person been
   * looked at" answerable -- the three statuses are the screen's three tabs
   * (Unmatched / Linked / Not a member).
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  list(@Query() query: FacebookAccountsQueryDto): Promise<FacebookAccountView[]> {
    return this.accounts.list(query.status);
  }

  /**
   * Ties a Facebook person to a member, and carries over what that already
   * implies (rule 14).
   *
   * The carry-over is a second call rather than part of `link` because the two
   * services would otherwise be circular: the sync needs the accounts service
   * to record who it saw. Orchestrating here keeps both dependencies pointing
   * one way and makes the order visible at the call site.
   *
   * It runs **after** the link is committed and its failure does not undo the
   * link: an admin who pressed Link must not be told it failed when the
   * mapping was saved and only the back-fill broke. The counts come back so
   * the screen can say what happened.
   */
  @Post(':id/link')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(200)
  async link(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LinkFacebookAccountDto,
    @CurrentUser() actor: User,
  ): Promise<{ upcoming: number; attended: number }> {
    await this.accounts.link(id, body.userId, actor.id);

    try {
      return await this.sync.carryOverLinkedAccount(id, body.userId, actor.id);
    } catch (error) {
      this.logger.error(
        `Linked Facebook account ${id} to member ${body.userId}, but the ` +
          `carry-over failed: ${String(error)}`,
      );
      return { upcoming: 0, attended: 0 };
    }
  }

  /**
   * Breaks the link and returns the person to the queue.
   *
   * Deliberately leaves any RSVP the sync created in place -- see the service.
   * Correcting a mapping must not silently drop somebody from a dinner they
   * may well be attending.
   */
  @Post(':id/unlink')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(204)
  unlink(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User): Promise<void> {
    return this.accounts.unlink(id, actor.id);
  }

  /** Still counted in the headcount, out of the review queue. */
  @Post(':id/not-a-member')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(204)
  markNotAMember(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: User,
  ): Promise<void> {
    return this.accounts.markNotAMember(id, actor.id);
  }

  /**
   * Attendance for a Facebook-only person, from the attendance dialog.
   *
   * `Patch`, because it changes one field of an existing record, and the field
   * is tri-state -- sending `null` puts a row back to "not marked", which is
   * what an admin needs after a mistaken tap.
   */
  @Patch(':id/attendance')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(204)
  markAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MarkFacebookAttendanceDto,
    @CurrentUser() actor: User,
  ): Promise<void> {
    return this.accounts.markAttendance(id, body.eventId, body.attended ?? null, actor.id);
  }

  /** Puts a `not_member` or `linked` row back in the queue for another look. */
  @Post(':id/unmatched')
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(204)
  markUnmatched(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: User,
  ): Promise<void> {
    return this.accounts.markUnmatched(id, actor.id);
  }
}
