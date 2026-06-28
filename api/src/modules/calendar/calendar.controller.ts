import { Controller, Get, Header, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';
import { CalendarService } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

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
}
