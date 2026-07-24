import { Controller, Get, Param } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

// Public, unguarded — Terms/Privacy/the home story section are visible to
// anonymous visitors, so the config values backing them must be too.
// getPublicValue() itself restricts this to the known legal-copy keys.
@Controller('config')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  // Declared before :key so it isn't swallowed by the generic route below —
  // bundles all branding values into one request for app bootstrap instead
  // of five separate GET /config/:key round-trips.
  @Get('branding')
  getBranding() {
    return this.appConfigService.getBrandingConfig();
  }

  @Get(':key')
  async getValue(@Param('key') key: string): Promise<{ value: string }> {
    return { value: await this.appConfigService.getPublicValue(key) };
  }
}
