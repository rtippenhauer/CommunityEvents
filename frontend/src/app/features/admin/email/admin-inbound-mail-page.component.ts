import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminInboundMailComponent } from './admin-inbound-mail.component';

/**
 * This community's inbound mail, on its own screen.
 *
 * It began as a card at the foot of Email Admin, which is a long page — Rob's
 * first note after using it was that reaching the log meant scrolling past
 * every setting (2026-10-21). A log is something you open when you are looking
 * for something, so it gets an address: a sidenav entry and a link from Email
 * Admin, neither of which involves scrolling.
 *
 * The operator's version of the same list is `/system/inbound-mail`, which adds
 * the rows belonging to no community. Both render the same component; the
 * `[operator]` input chooses which endpoint it calls, and the API decides what
 * comes back.
 */
@Component({
  selector: 'app-admin-inbound-mail-page',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, AdminInboundMailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-head">
        <h2 class="page-title">Inbound Mail</h2>
        <a mat-stroked-button routerLink="/admin/email">
          <mat-icon>arrow_back</mat-icon>
          Email settings
        </a>
      </div>
      <p class="intro">
        Replies your members send to calendar invites, and what happened to each one. A row
        appears whether or not the reply could be applied — which is the point: before this,
        a reply that could not be read left nothing behind.
      </p>
      <app-admin-inbound-mail />
    </div>
  `,
  styles: [
    `
      .page {
        max-width: 900px;
        margin: 0 auto;
        padding: 24px 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .page-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .page-title {
        margin: 0;
        font-family: var(--ce-font-display);
        color: var(--ce-text);
      }
      .intro {
        margin: 0;
        color: var(--ce-text-muted);
        font-size: 0.9rem;
        line-height: 1.5;
      }
    `,
  ],
})
export class AdminInboundMailPageComponent {}
