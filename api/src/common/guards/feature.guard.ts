import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY_META } from '../decorators/require-feature.decorator';
import { AppConfigService, FeatureKey } from '../../modules/app-config/app-config.service';

// Registered globally (APP_GUARD in AppConfigModule). No-ops on any route
// without @RequireFeature metadata; otherwise blocks the request with a 404
// when the named per-instance feature toggle is off.
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly appConfig: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY_META, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    if (!(await this.appConfig.isFeatureEnabled(feature))) {
      throw new NotFoundException('This feature is not enabled on this instance');
    }
    return true;
  }
}
