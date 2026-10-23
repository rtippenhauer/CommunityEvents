import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  ATTENTION_OUTCOMES,
  GOOD_OUTCOMES,
  InboundMailRow,
  InboundMailService,
  InboundOutcome,
  OUTCOME_LABELS,
} from '../../../core/services/inbound-mail.service';

/**
 * The inbound half of the email log (v2-34).
 *
 * ## One component, two audiences
 *
 * `[operator]` selects which of the two reads it calls, and that is the only
 * difference: a community's admins see their own rows, the operator sees every
 * row **including the ones that belong to no community** — which are the point
 * of that view rather than an exception to it, since a reply that resolved to
 * nothing is the shape a multi-tenant fault takes.
 *
 * The component does not filter anything itself. It cannot: the API decides
 * what each caller may see, and a screen that re-derived that rule would be a
 * second answer free to disagree with the first.
 *
 * Kept out of `admin-email.component.ts` deliberately — that file is already
 * 1,700 lines, and this has to render on two different screens.
 */
@Component({
  selector: 'app-admin-inbound-mail',
  standalone: true,
  imports: [
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- No card header: both screens that host this already carry the title and
         the description, and rendering them again inside the card showed
         "Inbound Mail" twice with two near-identical subtitles (stage,
         2026-10-22). The card is the frame, not a second heading. -->
    <mat-card>
      <mat-card-content>
        <div class="filters">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
            <mat-label>Search</mat-label>
            <input
              matInput
              [value]="search()"
              (keyup.enter)="search.set($any($event.target).value); reload(1)"
              (blur)="search.set($any($event.target).value); reload(1)"
              placeholder="From, to or subject"
            />
            <mat-icon matPrefix>search</mat-icon>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="outcome">
            <mat-label>Outcome</mat-label>
            <mat-select [value]="outcome()" (selectionChange)="outcome.set($event.value); reload(1)">
              <mat-option value="">Any outcome</mat-option>
              @for (o of outcomes; track o) {
                <mat-option [value]="o">{{ label(o) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-checkbox
            [checked]="failuresOnly()"
            (change)="failuresOnly.set($event.checked); reload(1)"
          >
            Problems only
          </mat-checkbox>

          @if (operator()) {
            <!-- The rows no community-level screen can ever show. First thing
                 to look at when a reply has gone astray. -->
            <mat-checkbox
              [checked]="unresolvedOnly()"
              (change)="unresolvedOnly.set($event.checked); reload(1)"
              matTooltip="Messages that matched no community at all"
            >
              Matched no community
            </mat-checkbox>
          }
        </div>

        @if (loading()) {
          <mat-spinner diameter="32" />
        } @else if (error()) {
          <p class="empty">{{ error() }}</p>
        } @else if (rows().length === 0) {
          <p class="empty">
            Nothing has arrived yet. That is the usual state — a row appears when a member
            replies to a calendar invite.
          </p>
        } @else {
          <ul class="rows">
            @for (row of rows(); track row.id) {
              <li [class.bad]="isFailure(row.outcome)" [class.attention]="needsAnswer(row.outcome)">
                <div class="line">
                  <span
                    class="badge"
                    [class.bad]="isFailure(row.outcome)"
                    [class.attention]="needsAnswer(row.outcome)"
                  >
                    {{ label(row.outcome) }}
                  </span>
                  @if (row.suppressedCount > 0) {
                    <span
                      class="folded"
                      matTooltip="Further identical failures from this source, folded into this row rather than filling the log"
                    >
                      +{{ row.suppressedCount }} more
                    </span>
                  }
                  @if (operator()) {
                    <span class="community">
                      @if (row.tenantName) {
                        {{ row.tenantName }}
                      } @else {
                        <em matTooltip="This message matched no community">no community</em>
                      }
                    </span>
                  }
                  <span class="when">{{ row.receivedAt | date: 'MMM d, h:mm a' }}</span>
                </div>

                <div class="who">
                  @if (row.fromAddress) {
                    <strong>{{ row.fromAddress }}</strong>
                  } @else {
                    <span class="nobody">no sender — a direct request, not an email</span>
                  }
                  @if (row.subject) {
                    <span class="subject">{{ row.subject }}</span>
                  }
                </div>

                @if (row.detail) {
                  <p class="detail">{{ row.detail }}</p>
                }

                <div class="meta">
                  @if (row.eventId) {
                    <span>event {{ row.eventId }}</span>
                  }
                  @if (row.rsvpStatus) {
                    <span>{{ row.rsvpStatus }}</span>
                  }
                  <span>{{ row.sizeBytes }} bytes</span>
                  @if (operator() && row.sourceIp) {
                    <span>from {{ row.sourceIp }}</span>
                  }
                  <!-- Offered only where something was kept. A request that
                       failed authentication has no stored body by design, and a
                       link that can only ever say "nothing was stored" reads as
                       a fault in the log rather than as that policy. -->
                  @if (row.hasBody) {
                    <button mat-button type="button" (click)="toggleBody(row.id)">
                      {{ openBodyId() === row.id ? 'Hide message' : 'Show message' }}
                    </button>
                  } @else {
                    <span class="nobody" matTooltip="Nothing is stored for a request that failed authentication">
                      no message stored
                    </span>
                  }
                </div>

                @if (openBodyId() === row.id) {
                  <pre class="body">{{ body() ?? 'Nothing was stored for this message.' }}</pre>
                }
              </li>
            }
          </ul>

          <div class="pager">
            <span>{{ total() }} total</span>
            <button mat-button type="button" [disabled]="page() === 1" (click)="reload(page() - 1)">
              Previous
            </button>
            <span>Page {{ page() }}</span>
            <button
              mat-button
              type="button"
              [disabled]="page() * limit >= total()"
              (click)="reload(page() + 1)"
            >
              Next
            </button>
          </div>
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }
      .search {
        flex: 1 1 220px;
      }
      .outcome {
        flex: 0 1 240px;
      }
      .empty {
        color: var(--ce-text-muted);
        font-size: 0.9rem;
      }
      ul.rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      ul.rows > li {
        border: 1px solid var(--ce-rule);
        border-radius: 8px;
        padding: 10px 12px;
        background: var(--ce-surface);
      }
      /* A failed row is marked by a rule down its edge, not by tinting the
         whole card: --ce-error-overlay is 75% opaque red, built to sit over an
         image (see event-card), and as a card background it would leave body
         copy unreadable. The badge carries words regardless, so the
         distinction survives a reader who cannot see the colour at all. */
      ul.rows > li.bad {
        border-left: 3px solid var(--ce-error-overlay);
      }
      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .badge {
        font-size: 0.75rem;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--ce-surface-variant);
        color: var(--ce-text);
      }
      /* The one place a literal white is correct: --ce-error-overlay is
         platform-fixed (red means error, whatever a community has chosen), so
         unlike a brand colour its lightness cannot change under us and the
         measured --ce-on-* indirection has nothing to measure. Same pattern as
         event-card's cancelled overlay. */
      .badge.bad {
        background: var(--ce-error-overlay);
        color: #fff;
      }
      /* A row somebody should answer, in the community's own accent rather than
         in red: a member proposing a different time is not a fault, and
         colouring it like one would teach an operator to ignore the colour. */
      ul.rows > li.attention {
        border-left: 3px solid var(--ce-accent);
      }
      .badge.attention {
        background: var(--ce-accent);
        color: var(--ce-on-accent);
      }
      .nobody {
        color: var(--ce-text-muted);
        font-style: italic;
      }
      .folded,
      .community,
      .when {
        font-size: 0.75rem;
        color: var(--ce-text-muted);
      }
      .when {
        margin-left: auto;
      }
      .who {
        margin-top: 6px;
        font-size: 0.9rem;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .subject {
        color: var(--ce-text-muted);
      }
      .detail {
        margin: 6px 0 0;
        font-size: 0.82rem;
        color: var(--ce-text);
        word-break: break-word;
      }
      .meta {
        margin-top: 4px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        font-size: 0.75rem;
        color: var(--ce-text-muted);
      }
      pre.body {
        margin: 10px 0 0;
        padding: 10px;
        background: var(--ce-surface-variant);
        border-radius: 6px;
        font-size: 0.72rem;
        max-height: 320px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .pager {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 14px;
        font-size: 0.8rem;
        color: var(--ce-text-muted);
      }
      @media (max-width: 600px) {
        .when {
          margin-left: 0;
        }
      }
    `,
  ],
})
export class AdminInboundMailComponent {
  private readonly service = inject(InboundMailService);

  /** True for the operator's deployment-wide view; false for one community's. */
  readonly operator = input(false);

  readonly limit = 25;

  readonly rows = signal<InboundMailRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly search = signal('');
  readonly outcome = signal('');
  readonly failuresOnly = signal(false);
  readonly unresolvedOnly = signal(false);

  readonly openBodyId = signal<number | null>(null);
  readonly body = signal<string | null>(null);

  readonly outcomes = Object.keys(OUTCOME_LABELS) as InboundOutcome[];

  constructor() {
    this.reload(1);
  }

  label(outcome: InboundOutcome | string): string {
    return OUTCOME_LABELS[outcome as InboundOutcome] ?? outcome;
  }

  isFailure(outcome: InboundOutcome): boolean {
    return !GOOD_OUTCOMES.includes(outcome) && !ATTENTION_OUTCOMES.includes(outcome);
  }

  /** Somebody asked for something: not a fault, but not nothing either. */
  needsAnswer(outcome: InboundOutcome): boolean {
    return ATTENTION_OUTCOMES.includes(outcome);
  }

  reload(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.openBodyId.set(null);
    const query = {
      q: this.search() || undefined,
      outcome: this.outcome() || undefined,
      failuresOnly: this.failuresOnly() || undefined,
      unresolvedOnly: this.operator() ? this.unresolvedOnly() || undefined : undefined,
      page,
      limit: this.limit,
    };
    const request = this.operator()
      ? this.service.forOperator(query)
      : this.service.forCommunity(query);
    request.subscribe({
      next: (res) => {
        this.rows.set(res.rows);
        this.total.set(res.total);
        this.page.set(res.page);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load the inbound log.');
        this.loading.set(false);
      },
    });
  }

  toggleBody(id: number): void {
    if (this.openBodyId() === id) {
      this.openBodyId.set(null);
      return;
    }
    this.openBodyId.set(id);
    this.body.set(null);
    const request = this.operator()
      ? this.service.bodyForOperator(id)
      : this.service.bodyForCommunity(id);
    request.subscribe({
      next: (res) => this.body.set(res.raw),
      error: () => this.body.set(null),
    });
  }
}
