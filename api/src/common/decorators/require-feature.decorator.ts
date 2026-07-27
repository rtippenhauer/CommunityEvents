import { SetMetadata } from '@nestjs/common';
import { FeatureKey } from '../../modules/app-config/app-config.service';

// Marks a controller or route handler as gated behind a per-instance feature
// toggle. The global FeatureGuard reads this and returns 404 when the feature
// is disabled, so a fork that turns a feature off has its endpoints behave as
// if they don't exist — the client never has to be trusted to hide the nav.
export const FEATURE_KEY_META = 'require_feature';
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY_META, feature);
