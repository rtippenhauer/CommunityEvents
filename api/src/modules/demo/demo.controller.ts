import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { DemoService, DemoRequestResult } from './demo.service';
import { RequestDemoDto } from './dto/request-demo.dto';

/**
 * Asking for a demo community, and confirming it (v2-14).
 *
 * Both routes are unauthenticated by necessity -- the whole point is somebody
 * with no account and no invite -- which makes this the only place in the API
 * where an anonymous caller causes a tenant to exist. The protections are
 * therefore all here or in the service: a throttle on both routes, a cap on
 * live demos, a cap per IP, and a confirmation step so nothing is created until
 * a real mailbox has been reached.
 *
 * These run on the ROOT tenant's host, because that is where the landing page
 * is and because a demo's own host does not exist until the demo does.
 */
@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  /**
   * Tighter than the 5/min the auth routes carry: registering is something a
   * member does once, but this creates a *community*, and the pool it draws
   * from is ten.
   */
  @Post('request')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  async request(
    @Body() dto: RequestDemoDto,
    @Req() req: Request,
  ): Promise<DemoRequestResult> {
    return this.demoService.requestDemo(dto.fullName, dto.email, dto.password, req.ip);
  }

  /**
   * A GET, because it is reached by clicking a link in an email, and it is
   * not idempotent -- which is a deliberate exception rather than an oversight.
   * The alternative is a page that asks the visitor to press a button to
   * confirm the thing they already confirmed, and the risk a GET usually
   * guards against (a prefetcher firing it) costs a demo slot for a person who
   * was about to use it anyway. `already_confirmed` makes the second call
   * harmless.
   */
  @Get('confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirm(@Query('token') token: string): Promise<{ url: string; expiresAt: Date }> {
    return this.demoService.confirmDemo(token ?? '');
  }
}
