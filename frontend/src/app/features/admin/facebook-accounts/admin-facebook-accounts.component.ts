import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FacebookAccountsService,
  type FacebookAccount,
  type FacebookAccountStatus,
} from '../../../core/services/facebook-accounts.service';

interface AdminUserRow {
  id: number;
  fullName: string;
  email: string;
}

/**
 * Admin → Facebook Accounts (v2-29).
 *
 * The review queue for people seen on the community's Facebook Going lists, and
 * **the only place a Facebook person is tied to a member.** The server records
 * who it saw and never links anybody (rule 5), so without this screen every
 * Facebook person stays unmatched for ever and no member is ever marked Going
 * by the sync.
 *
 * Three tabs, because the three statuses answer different questions:
 * Unmatched is the work queue, Linked is what has been decided, and Not a
 * member is somebody real who has no account here -- **still counted** in the
 * headcount, just not waiting for a decision.
 *
 * Suggestions are an exact name match offered for confirmation, never applied.
 * The screen shows them as buttons so the common case is one tap, and the
 * member search beside them is for everything else.
 */
@Component({
  selector: 'app-admin-facebook-accounts',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    MatCardModule,
    MatTabsModule,
    MatChipsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fb-accounts">
      <h2>Facebook Accounts</h2>
      <p class="lede">
        People seen on this community's Facebook event Going lists. Linking one to
        a member lets the sync mark them Going and count their +1s. Nobody is
        linked automatically — two people can share a name.
      </p>

      <mat-tab-group [selectedIndex]="tabIndex()" (selectedIndexChange)="selectTab($event)">
        <mat-tab [label]="'Unmatched (' + counts().unmatched + ')'" />
        <mat-tab [label]="'Linked (' + counts().linked + ')'" />
        <mat-tab [label]="'Not a member (' + counts().not_member + ')'" />
      </mat-tab-group>

      @if (loading()) {
        <p class="empty">Loading…</p>
      } @else if (visible().length === 0) {
        <p class="empty">
          @switch (tab()) {
            @case ('unmatched') { Nobody is waiting to be matched. }
            @case ('linked') { No Facebook accounts are linked to a member yet. }
            @default { Nobody has been marked as having no account here. }
          }
        </p>
      } @else {
        @for (account of visible(); track account.id) {
          <mat-card appearance="outlined" class="account">
            <mat-card-content>
              <div class="head">
                <div class="who">
                  <h3>{{ account.displayName }}</h3>
                  @if (account.profileUrl) {
                    <a [href]="account.profileUrl" target="_blank" rel="noopener noreferrer">
                      {{ account.profileUrl }}
                    </a>
                  }
                  <p class="seen">
                    Last seen
                    {{ account.lastSeenAt ? (account.lastSeenAt | date: 'medium') : 'never' }}
                  </p>
                </div>

                @if (account.status === 'linked') {
                  <div class="linked-to">
                    <mat-chip>{{ account.memberName }}</mat-chip>
                    @if (account.memberIsBannedOrDeleted) {
                      <!-- Rule 13: the link is kept, the person is not counted.
                           Flagged rather than hidden so an admin can see why a
                           Going list and the headcount disagree. -->
                      <mat-chip
                        class="banned"
                        matTooltip="Banned or deleted: kept linked, never added and never counted"
                      >
                        Banned or deleted
                      </mat-chip>
                    }
                  </div>
                }
              </div>

              @if (account.status === 'unmatched') {
                @if (account.suggestions.length > 0) {
                  <div class="suggestions">
                    <span class="label">Same name:</span>
                    @for (suggestion of account.suggestions; track suggestion.id) {
                      <button
                        mat-stroked-button
                        type="button"
                        (click)="link(account, suggestion.id)"
                      >
                        <mat-icon>link</mat-icon> {{ suggestion.fullName }}
                      </button>
                    }
                  </div>
                }

                <div class="search">
                  <mat-form-field appearance="outline">
                    <mat-label>Link to a member</mat-label>
                    <mat-select
                      [value]="null"
                      (valueChange)="link(account, $event)"
                      panelClass="member-panel"
                    >
                      @for (member of members(); track member.id) {
                        <mat-option [value]="member.id">
                          {{ member.fullName }} — {{ member.email }}
                        </mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
              }

              <div class="actions">
                @if (account.status !== 'unmatched') {
                  <button mat-stroked-button type="button" (click)="unmatch(account)">
                    <mat-icon>undo</mat-icon> Back to unmatched
                  </button>
                }
                @if (account.status === 'unmatched') {
                  <button
                    mat-stroked-button
                    type="button"
                    matTooltip="Still counted in the headcount, just not waiting for a decision"
                    (click)="notAMember(account)"
                  >
                    <mat-icon>person_off</mat-icon> Not a member
                  </button>
                }
                @if (account.status === 'linked') {
                  <button mat-stroked-button type="button" (click)="unlink(account)">
                    <mat-icon>link_off</mat-icon> Unlink
                  </button>
                }
              </div>
            </mat-card-content>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [
    `
      .fb-accounts {
        max-width: 60rem;
        margin: 0 auto;
        padding: 1.5rem 1rem;
      }
      h2 {
        color: var(--ce-text);
        margin: 0 0 0.5rem;
      }
      .lede {
        color: var(--ce-text-muted);
        margin: 0 0 1.25rem;
        max-width: 48rem;
      }
      mat-card.account {
        margin: 1rem 0;
        background: var(--ce-surface);
      }
      .head {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .who h3 {
        margin: 0;
        color: var(--ce-text);
      }
      .who a {
        font-size: 0.82rem;
        color: var(--ce-primary);
        overflow-wrap: anywhere;
      }
      .seen {
        margin: 0.25rem 0 0;
        font-size: 0.8rem;
        color: var(--ce-text-muted);
      }
      .linked-to {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        align-items: flex-start;
      }
      /* --ce-error-overlay is the platform-fixed error tint (v2-11): banned
         means the same thing in every community, so it is one of the
         deliberate exceptions to per-community branding. */
      mat-chip.banned {
        background: var(--ce-error-overlay);
      }
      .suggestions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
        margin: 1rem 0 0.5rem;
      }
      .suggestions .label {
        color: var(--ce-text-muted);
        font-size: 0.85rem;
      }
      .search mat-form-field {
        width: 100%;
        max-width: 26rem;
        margin-top: 0.5rem;
      }
      .actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: 0.5rem;
      }
      .empty {
        color: var(--ce-text-muted);
        padding: 1.5rem 0;
      }
    `,
  ],
})
export class AdminFacebookAccountsComponent implements OnInit {
  private readonly accountsService = inject(FacebookAccountsService);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  private readonly tabs: FacebookAccountStatus[] = ['unmatched', 'linked', 'not_member'];

  readonly all = signal<FacebookAccount[]>([]);
  readonly members = signal<AdminUserRow[]>([]);
  readonly loading = signal(true);
  readonly tabIndex = signal(0);

  readonly tab = computed<FacebookAccountStatus>(() => this.tabs[this.tabIndex()]);

  readonly visible = computed(() =>
    this.all().filter((account) => account.status === this.tab()),
  );

  /** Tab labels carry counts, so an empty queue is visible without opening it. */
  readonly counts = computed(() => {
    const counts = { unmatched: 0, linked: 0, not_member: 0 };
    for (const account of this.all()) counts[account.status] += 1;
    return counts;
  });

  ngOnInit(): void {
    this.load();

    // `/admin/users` rather than `/users/members`: the member directory is
    // behind `feature_members`, and a community with that feature off must
    // still be able to link Facebook accounts.
    this.http.get<AdminUserRow[]>('/api/v1/admin/users').subscribe({
      next: (rows) => this.members.set(rows),
      error: () => this.members.set([]),
    });
  }

  selectTab(index: number): void {
    this.tabIndex.set(index);
  }

  link(account: FacebookAccount, userId: number | null): void {
    if (userId === null) return;
    this.act(this.accountsService.link(account.id, userId), 'Linked');
  }

  unlink(account: FacebookAccount): void {
    this.act(this.accountsService.unlink(account.id), 'Unlinked');
  }

  notAMember(account: FacebookAccount): void {
    this.act(this.accountsService.markNotAMember(account.id), 'Marked as not a member');
  }

  unmatch(account: FacebookAccount): void {
    this.act(this.accountsService.markUnmatched(account.id), 'Back in the queue');
  }

  private act(request: { subscribe: (observer: object) => void }, done: string): void {
    request.subscribe({
      next: () => {
        this.snackBar.open(done, undefined, { duration: 2500 });
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.snackBar.open(error.error?.message ?? 'That did not work', 'Dismiss', {
          duration: 6000,
        });
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    // Every status in one request: the tab counts need all three, and the list
    // is a review queue rather than an unbounded log.
    this.accountsService.list().subscribe({
      next: (accounts) => {
        this.all.set(accounts);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Could not load Facebook accounts', 'Dismiss', { duration: 6000 });
      },
    });
  }
}
