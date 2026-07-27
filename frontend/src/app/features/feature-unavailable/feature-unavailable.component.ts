import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ErrorPageComponent } from '../../shared/components/error-page/error-page.component';

// Shown when a user navigates directly to a feature this instance has turned
// off (see featureGuard). Kept generic — no feature name — since a single page
// backs every toggle and the nav already hides enabled-elsewhere items.
@Component({
  selector: 'app-feature-unavailable',
  standalone: true,
  imports: [ErrorPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <app-error-page
      icon="do_not_disturb_on"
      title="Not available"
      body="This feature isn't enabled on this site."
      [showHomeButton]="true"
    />
  `,
})
export class FeatureUnavailableComponent {}
