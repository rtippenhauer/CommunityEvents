import { Controller, Get, Headers, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { HealthService, HealthStatus } from './health.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(
    // Read from the header rather than req.tenant: this route is exempt from
    // TenantMiddleware (see UNSCOPED_PATHS), so nothing has resolved the host
    // yet — reporting what an unrecognized host *would* have done is the point.
    @Headers('host') host: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatus> {
    const health = await this.healthService.check(host);
    if (health.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }
}
