import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

@Controller('api/health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
