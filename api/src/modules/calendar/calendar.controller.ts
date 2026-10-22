import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsEnum, IsBoolean, IsOptional, IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CalendarService, CalendarSettingsResponse } from './calendar.service';
import { InboundEmailLogService } from '../email/inbound-email-log.service';
import { InboundEmailOutcome } from '../../database/enums';
import { clientIpFrom } from '../../common/utils/client-ip.util';
import type { users as User } from '@prisma/client';

class UpdateCalendarSettingsDto {
  @IsOptional()
  @IsEnum(['all', 'city'])
  cityFilter?: 'all' | 'city';

  @IsOptional()
  @IsBoolean()
  rsvpOnly?: boolean;

  @IsOptional()
  @IsEnum(['none', 'city', 'all'])
  autoInvite?: 'none' | 'city' | 'all';
}

/**
 * The Worker's POST body.
 *
 * **Not used as a `@Body()` type**, deliberately: the global `ValidationPipe`
 * would reject a malformed body before `rsvpReply` runs, and v2-34 requires
 * that failure to be logged from the handler like the other twelve. Kept as the
 * documented shape, and asserted by a spec against what the handler accepts, so
 * the two cannot drift silently.
 */
export class RsvpReplyDto {
  @IsString()
  raw!: string;
}

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly config: ConfigService,
    private readonly inboundLog: InboundEmailLogService,
  ) {}

  @Get('feed.ics')
  @Header('Cache-Control', 'no-store, no-cache')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async feed(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) throw new UnauthorizedException('Calendar token required');
    const ics = await this.calendarService.getFeed(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
    res.end(ics);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(@CurrentUser() user: User): Promise<CalendarSettingsResponse> {
    return this.calendarService.getSettings(user.id);
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(
    @CurrentUser() user: User,
    @Body() dto: UpdateCalendarSettingsDto,
  ): Promise<CalendarSettingsResponse> {
    return this.calendarService.updateSettings(user.id, dto);
  }

  @Get('token')
  @UseGuards(JwtAuthGuard)
  async getToken(@CurrentUser() user: User): Promise<{ url: string }> {
    const token = await this.calendarService.getOrCreateToken(user.id);
    return { url: await this.calendarService.feedUrl(token) };
  }

  @Get('token/regenerate')
  @UseGuards(JwtAuthGuard)
  async regenerateToken(@CurrentUser() user: User): Promise<{ url: string }> {
    const token = await this.calendarService.regenerateToken(user.id);
    return { url: await this.calendarService.feedUrl(token) };
  }

  /**
   * Inbound calendar replies, posted by the Cloudflare email Worker.
   *
   * ## Every write to the inbound log happens here, and that is deliberate
   *
   * Rob's call (2026-10-20): all thirteen outcomes land in one place rather
   * than being spread across a validation pipe, a guard and a service. Which
   * is why this takes an `unknown` body and validates it by hand instead of
   * declaring `@Body() dto: RsvpReplyDto` — **the global `ValidationPipe`
   * rejects a malformed body before the handler runs**, so a DTO here would put
   * one of the two pre-parser failures somewhere this method could never see
   * it, and it is the failure most likely to mean somebody is probing us.
   *
   * `RsvpReplyDto` is kept for the shape it documents and is checked below.
   *
   * ## Why a bad secret is logged but its body is not
   *
   * This route is unauthenticated by necessity — the Worker has no session —
   * so anything on the internet can reach it. A rejected request still gets a
   * row, because that is the failure that cost `v2-33`'s stage pass two days
   * when the container held two rows for the secret and docker took the blank
   * one. But its body is attacker-supplied content, so only its size and
   * source are kept.
   */
  @Post('rsvp-reply')
  @HttpCode(200)
  async rsvpReply(
    @Headers('x-cloudflare-secret') secret: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    const sourceIp = clientIpFrom(req);
    const raw = typeof (body as { raw?: unknown })?.raw === 'string'
      ? (body as { raw: string }).raw
      : null;
    const sizeBytes = raw ? Buffer.byteLength(raw, 'utf8') : 0;

    const expected = this.config.get<string>('CLOUDFLARE_EMAIL_SECRET', '');
    if (!expected || secret !== expected) {
      await this.inboundLog.record({
        outcome: InboundEmailOutcome.INVALID_SECRET,
        detail: expected
          ? 'the X-Cloudflare-Secret header did not match'
          : 'CLOUDFLARE_EMAIL_SECRET is not set on this deployment',
        // The host's community, since nothing has been parsed yet. A reply we
        // refuse at the door still tells its community that something tried.
        tenantId: req.tenant?.id ?? null,
        storeBody: false,
        sizeBytes,
        sourceIp,
      });
      throw new UnauthorizedException('Invalid Cloudflare secret');
    }

    if (raw === null || raw.length === 0) {
      await this.inboundLog.record({
        outcome: InboundEmailOutcome.MALFORMED_REQUEST,
        detail: 'expected a JSON body with a non-empty string "raw"',
        tenantId: req.tenant?.id ?? null,
        storeBody: false,
        sizeBytes,
        sourceIp,
      });
      throw new BadRequestException('Expected { raw: string }');
    }

    // The host only narrows which community a reply may be about; the event
    // its UID names decides which one it is. See processRsvpReply.
    const result = await this.calendarService.processRsvpReply(raw, req.tenant);

    await this.inboundLog.record({
      outcome: result.outcome,
      detail: result.detail ?? null,
      // Falls back to the host's community only when the parser never got far
      // enough to resolve one. `undefined` means "not determined", which is
      // different from the explicit `null` a resolved-to-nothing row carries.
      tenantId: result.tenantId !== undefined ? result.tenantId : (req.tenant?.id ?? null),
      eventId: result.eventId ?? null,
      userId: result.userId ?? null,
      rsvpStatus: result.rsvpStatus ?? null,
      raw,
      sizeBytes,
      sourceIp,
    });

    return { ok: true };
  }
}
