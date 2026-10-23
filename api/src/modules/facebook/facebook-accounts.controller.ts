import {
  Body,
  Controller,
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
 * Under `admin/` and `@Roles(ADMIN)`: these are one community's own links, made
 * by its own admin. Not `moderator`, because a wrong link marks the wrong
 * member Going and emails them a confirmation.
 */
@Controller('admin/facebook-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacebookAccountsController {
  constructor(private readonly accounts: FacebookAccountsService) {}

  /**
   * The review queue, filterable by status.
   *
   * No filter returns everything, which is what makes "has this person been
   * looked at" answerable -- the three statuses are the screen's three tabs
   * (Unmatched / Linked / Not a member).
   */
  @Get()
  @Roles(UserRole.ADMIN)
  list(@Query() query: FacebookAccountsQueryDto): Promise<FacebookAccountView[]> {
    return this.accounts.list(query.status);
  }

  @Post(':id/link')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  link(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LinkFacebookAccountDto,
    @CurrentUser() actor: User,
  ): Promise<void> {
    return this.accounts.link(id, body.userId, actor.id);
  }

  /**
   * Breaks the link and returns the person to the queue.
   *
   * Deliberately leaves any RSVP the sync created in place -- see the service.
   * Correcting a mapping must not silently drop somebody from a dinner they
   * may well be attending.
   */
  @Post(':id/unlink')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  unlink(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: User): Promise<void> {
    return this.accounts.unlink(id, actor.id);
  }

  /** Still counted in the headcount, out of the review queue. */
  @Post(':id/not-a-member')
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  markUnmatched(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: User,
  ): Promise<void> {
    return this.accounts.markUnmatched(id, actor.id);
  }
}
