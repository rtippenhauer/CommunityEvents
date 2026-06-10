import { Component } from '@angular/core';
import { ErrorPageComponent } from '../../shared/components/error-page/error-page.component';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [ErrorPageComponent],
  template: `
    <app-error-page
      icon="search_off"
      title="Page not found"
      body="We couldn't find that page. It may have moved or never existed."
      [showHomeButton]="true"
    />
  `,
})
export class NotFoundComponent {}
