import { Body, Controller, Get, Header, Headers, HttpCode, Patch, Post, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsEnum, IsBoolean, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';
import { CalendarService, CalendarSettingsResponse } from './calendar.service';

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

class RsvpReplyDto {
  @IsString()
  raw!: string;
}

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly config: ConfigService,
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
    res.setHeader('Content-Disposition', 'inline; filename="dinnerbears.ics"');
    res.end(ics);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(@CurrentUser() user: UserEntity): Promise<CalendarSettingsResponse> {
    return this.calendarService.getSettings(user.id);
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateCalendarSettingsDto,
  ): Promise<CalendarSettingsResponse> {
    return this.calendarService.updateSettings(user.id, dto);
  }

  @Get('token')
  @UseGuards(JwtAuthGuard)
  async getToken(@CurrentUser() user: UserEntity): Promise<{ url: string }> {
    const token = await this.calendarService.getOrCreateToken(user.id);
    return { url: this.calendarService.feedUrl(token) };
  }

  @Get('token/regenerate')
  @UseGuards(JwtAuthGuard)
  async regenerateToken(@CurrentUser() user: UserEntity): Promise<{ url: string }> {
    const token = await this.calendarService.regenerateToken(user.id);
    return { url: this.calendarService.feedUrl(token) };
  }

  @Post('rsvp-reply')
  @HttpCode(200)
  async rsvpReply(
    @Headers('x-cloudflare-secret') secret: string | undefined,
    @Body() dto: RsvpReplyDto,
  ): Promise<{ ok: boolean }> {
    const expected = this.config.get<string>('CLOUDFLARE_EMAIL_SECRET', '');
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid Cloudflare secret');
    }
    await this.calendarService.processRsvpReply(dto.raw);
    return { ok: true };
  }
}
