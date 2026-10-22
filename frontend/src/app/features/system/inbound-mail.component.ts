import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AdminInboundMailComponent } from '../admin/email/admin-inbound-mail.component';

/**
 * The operator's view of inbound mail across every community (v2-34).
 *
 * The same component as the per-community card, with `[operator]="true"` — the
 * only difference being which endpoint it calls, and therefore what the API
 * allows back. The screen does not filter anything itself: a client that
 * re-derived "who may see which rows" would be a second answer free to
 * disagree with the server's.
 *
 * What this adds over a community's own view is the rows belonging to **no**
 * community, which no per-community query can ever return and which are the
 * shape a multi-tenant fault takes — a reply that resolved to nothing.
 */
@Component({
  selector: 'app-system-inbound-mail',
  standalone: true,
  imports: [AdminInboundMailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <h2 class="page-title">Inbound Mail</h2>
      <p class="intro">
        Every message that reached this deployment and what became of it, across all communities
        — including the ones that matched no community at all, which is usually where a reply has
        gone astray.
      </p>
      <app-admin-inbound-mail [operator]="true" />
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
export class SystemInboundMailComponent {}
