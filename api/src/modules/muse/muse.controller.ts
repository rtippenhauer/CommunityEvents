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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { MuseTokenGuard } from './muse-token.guard';
import { MuseService, type MuseFacebookEvent, type MuseIdentity } from './muse.service';
import { LinkFacebookEventDto } from './dto/link-facebook-event.dto';
import { CreateMuseInviteDto } from './dto/create-muse-invite.dto';
import { MuseEventsQueryDto } from './dto/muse-events-query.dto';
import { MuseLocationsQueryDto } from './dto/muse-locations-query.dto';
import { FacebookSyncDto } from '../facebook/dto/facebook-sync.dto';
import type { IssuedToken } from '../integrations/api-token.service';
import type { SyncReport } from '../facebook/facebook-sync.service';

/**
 * The Muse integration API (v2-29). v1's contract, under `/api/v1/muse`.
 *
 * **Every route is the token's, and only the token's.** `MuseTokenGuard`
 * ignores `req.user` entirely, so no session reaches these routes -- and the
 * token is read only by the middleware mounted on this prefix, so it
 * authenticates nothing anywhere else.
 *
 * Muse routes carry their own 120/min limit rather than inheriting the
 * member-facing one: a sync run is a burst of calls from a single caller,
 * which is precisely what the ordinary limit exists to refuse.
 *
 * `@HttpCode(200)` on the two POSTs that are not creates, because v1's contract
 * documents 200 and Nest defaults a POST to 201. A status code is part of a
 * contract an outside app already handles.
 */
@Controller('muse')
@UseGuards(MuseTokenGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class MuseController {
  constructor(private readonly muse: MuseService) {}

  // ---- token -----------------------------------------------------------

  /**
   * Who this token is, and which community it speaks for.
   *
   * The smoke test for the whole arrangement, and what Muse calls at the start
   * of every run to decide whether to rotate.
   */
  @Get('me')
  me(@Req() req: Request): Promise<MuseIdentity> {
    return this.muse.identify(req.museToken!.userId, req.museToken!.tokenId);
  }

  /**
   * Muse replacing its own credential.
   *
   * Issuing revokes every other live token, so the token that made *this* call
   * stops working the moment the new one is returned. The contract says so in
   * capitals, and it is why the response is the only place the new token ever
   * appears.
   */
  @Post('token/rotate')
  @HttpCode(200)
  rotate(@Req() req: Request): Promise<IssuedToken> {
    return this.muse.rotateToken(req.museToken!.userId);
  }

  // ---- read ------------------------------------------------------------

  @Get('users')
  members() {
    return this.muse.members();
  }

  @Get('locations')
  locations(@Query() query: MuseLocationsQueryDto) {
    return this.muse.locationsFor({ cityId: query.cityId, search: query.search });
  }

  @Get('events')
  events(@Query() query: MuseEventsQueryDto) {
    return this.muse.events({ cityId: query.cityId, fromDate: query.fromDate });
  }

  @Get('events/:id')
  event(@Param('id', ParseIntPipe) id: number) {
    return this.muse.event(id);
  }

  @Get('events/:id/attendees')
  attendees(@Param('id', ParseIntPipe) id: number) {
    return this.muse.attendees(id);
  }

  // ---- Facebook event links --------------------------------------------

  /**
   * PUT, not POST: linking is idempotent and the caller names the resource.
   * Repeating it updates the group and is explicitly "safe to repeat".
   */
  @Put('events/:id/facebook-events/:facebookEventId')
  @HttpCode(200)
  linkFacebookEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('facebookEventId') facebookEventId: string,
    @Body() body: LinkFacebookEventDto,
    @Req() req: Request,
  ): Promise<MuseFacebookEvent> {
    return this.muse.linkFacebookEvent(
      id,
      facebookEventId,
      body.group ?? null,
      req.museToken!.userId,
    );
  }

  @Delete('events/:id/facebook-events/:facebookEventId')
  @HttpCode(200)
  unlinkFacebookEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('facebookEventId') facebookEventId: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    return this.muse.unlinkFacebookEvent(id, facebookEventId, req.museToken!.userId);
  }

  // ---- invite links ----------------------------------------------------

  @Get('events/:id/invite-links')
  inviteLinks(@Param('id', ParseIntPipe) id: number) {
    return this.muse.inviteLinks(id);
  }

  @Post('events/:id/invite-links')
  createInviteLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateMuseInviteDto,
    @Req() req: Request,
  ) {
    return this.muse.createInviteLink(id, body.flavor, req.museToken!.userId);
  }

  @Patch('events/:id/invite-links/:inviteId/revoke')
  @HttpCode(200)
  revokeInviteLink(
    @Param('id', ParseIntPipe) id: number,
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    return this.muse.revokeInviteLink(id, inviteId, req.museToken!.userId);
  }

  // ---- the sync --------------------------------------------------------

  /**
   * The batch sync. One call carries every Facebook event's Going list, which
   * is what lets rule 1 apply them all before reconciling any dinner.
   */
  @Post('facebook-sync')
  @HttpCode(200)
  sync(@Body() body: FacebookSyncDto, @Req() req: Request): Promise<SyncReport> {
    return this.muse.sync(body, req.museToken!.userId);
  }
}
