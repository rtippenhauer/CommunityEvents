import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  AdminTenant,
  DemoRequestList,
  PendingDemoRequest,
  TenantsAdminService,
} from '../../../core/services/tenants-admin.service';
import {
  TenantFormDialogComponent,
  TenantFormDialogData,
} from './tenant-form-dialog.component';
import { TenantDeleteDialogComponent } from './tenant-delete-dialog.component';
import { TenantUsersDialogComponent } from './tenant-users-dialog.component';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';

/**
 * The tenant registry, for the system admin (REQ-TENANT-01.7).
 *
 * Lives under /admin/ alongside the other admin screens for navigational
 * familiarity, but it is the only one gated by systemAdminGuard rather than
 * adminGuard — a community's admin cannot reach it, and the API refuses it a
 * second time regardless.
 *
 * Laid out as a list rather than a grid of cards. A community is one name, one
 * domain, three numbers and three actions -- a row holds that, where a
 * fixed-width card did not: the third action overflowed the card and, on every
 * community but the last, was hidden underneath the next one, which looked like
 * the delete button simply not existing. (Rob, 2026-08-18.)
 *
 * Delete is offered only on a community that is already suspended, and then
 * only behind a retyped domain. Suspending stays the ordinary way to take one
 * offline -- instant, reversible, and what the Active toggle does; deleting
 * removes every row that belongs to the community and cannot be undone.
 *
 * The People button is here rather than inside that community because a system
 * admin has no account there: its own admin screens live on its host behind a
 * session for it.
 */
@Component({
  selector: 'app-admin-tenants',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="tenants-container">
      <div class="tenants-header">
        <div>
          <h2>Communities</h2>
          <p class="subtitle">
            Every community on this deployment. Each one is a domain — point DNS and the reverse
            proxy here, or it will never be reached.
          </p>
        </div>
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> Add Community
        </button>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else {
        <!-- Only offered once there is something to sift. A filter above a
             list of two communities is furniture. -->
        @if (tenants().length > 2) {
          <div class="list-controls">
            <mat-button-toggle-group
              [value]="filter()"
              (change)="filter.set($event.value)"
              aria-label="Which communities to show"
              hideSingleSelectionIndicator
            >
              <mat-button-toggle value="all">All ({{ tenants().length }})</mat-button-toggle>
              <mat-button-toggle value="real">
                Communities ({{ realCount() }})
              </mat-button-toggle>
              <mat-button-toggle value="demo">Demos ({{ demoCount() }})</mat-button-toggle>
            </mat-button-toggle-group>

            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sort-field">
              <mat-label>Sort by</mat-label>
              <mat-select [value]="sort()" (selectionChange)="sort.set($event.value)">
                <mat-option value="default">Name</mat-option>
                <mat-option value="expires">Expires soonest</mat-option>
                <mat-option value="lastUsed">Last used</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        }

        <!-- A list, not a grid of cards. The row is what a community actually
             is here: one name, one domain, three numbers and three actions.
             Cards forced all of that into a fixed-width column, and the third
             action pushed the delete button outside the card entirely -- on
             every community except the last, where it landed underneath the
             next card and looked like it was missing. -->
        <div class="tenant-list" role="list">
          @for (tenant of visibleTenants(); track tenant.id) {
            <div
              class="tenant-row"
              role="listitem"
              [class.suspended]="tenant.status === 'suspended'"
            >
              <div class="identity">
                <div class="name-line">
                  <span class="slug">{{ tenant.slug }}</span>
                  @if (tenant.isRoot) {
                    <mat-chip class="chip-root">Root</mat-chip>
                  }
                  @if (tenant.status === 'suspended') {
                    <mat-chip class="chip-suspended">Suspended</mat-chip>
                  }
                  @if (tenant.isDemo) {
                    <mat-chip class="chip-demo">{{ demoLabel(tenant) }}</mat-chip>
                  }
                </div>
                <a class="domain" [href]="'https://' + tenant.domain" target="_blank" rel="noopener">
                  {{ tenant.domain }}
                </a>
                <!-- Shown always, not only when sorting by it: a sort control
                     that orders by something invisible looks broken. -->
                <span class="last-used">{{ lastUsedLabel(tenant) }}</span>
              </div>

              <div class="stats">
                <div class="stat">
                  <span class="stat-value">{{ tenant.memberCount }}</span>
                  <span class="stat-label">Members</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ tenant.eventCount }}</span>
                  <span class="stat-label">Events</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ tenant.locationCount }}</span>
                  <span class="stat-label">Locations</span>
                </div>
              </div>

              <div class="actions">
                <button
                  mat-icon-button
                  (click)="openEdit(tenant)"
                  [attr.aria-label]="'Edit ' + tenant.slug"
                  matTooltip="Edit"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  mat-icon-button
                  (click)="openUsers(tenant)"
                  [attr.aria-label]="'Manage people in ' + tenant.slug"
                  matTooltip="People"
                >
                  <mat-icon>group</mat-icon>
                </button>
                <!-- Suspended, non-root only: the API refuses to delete an
                     active community, so offering it here would only produce an
                     error. The slot is held open either way so the row's
                     controls do not shift position between communities. -->
                <!-- A demo needs no suspend-first: it is disposable by
                     construction and deletes itself within the week, so the
                     API waives that gate for demos only. -->
                @if (!tenant.isRoot && (tenant.isDemo || tenant.status === 'suspended')) {
                  <button
                    mat-icon-button
                    class="delete-btn"
                    (click)="openDelete(tenant)"
                    [attr.aria-label]="'Delete ' + tenant.slug"
                    matTooltip="Delete permanently"
                  >
                    <mat-icon>delete_forever</mat-icon>
                  </button>
                } @else {
                  <span
                    class="action-placeholder"
                    [matTooltip]="
                      tenant.isRoot
                        ? 'The root community cannot be deleted'
                        : 'Suspend this community before it can be deleted'
                    "
                  ></span>
                }
              </div>
            </div>
          }
        </div>

        @if (visibleTenants().length === 0) {
          <p class="single-note">No communities match that filter.</p>
        }

        @if (tenants().length === 1) {
          <p class="single-note">
            This deployment serves one community. Adding another is a database row, not another
            deployment — but its domain still needs DNS and a reverse-proxy entry pointing here.
          </p>
        }

        <!-- Only where demos are actually in play. On a deployment nobody has
             asked for one this is furniture explaining a feature that is not
             being used. -->
        @if (demoRequests().length > 0 || demoCount() > 0) {
          <section class="demo-requests">
            <h3>Demo requests</h3>
            <p class="subtitle">
              People who asked for a demo. A request creates nothing until its link is followed, so
              these hold a slot without appearing above.
              <strong
                >{{ capacity().live + capacity().awaiting }} of {{ capacity().max }} slots in
                use</strong
              >
              — {{ capacity().live }} set up, {{ capacity().awaiting }} awaiting confirmation.
            </p>

            @if (demoRequests().length === 0) {
              <p class="single-note">No requests are outstanding.</p>
            } @else {
              <div class="request-list" role="list">
                @for (req of demoRequests(); track req.id) {
                  <div class="request-row" role="listitem" [class.lapsed]="req.status === 'lapsed'">
                    <div class="identity">
                      <div class="name-line">
                        <span class="slug">{{ req.fullName }}</span>
                        <mat-chip
                          [class.chip-awaiting]="req.status === 'awaiting'"
                          [class.chip-lapsed]="req.status === 'lapsed'"
                        >
                          {{ req.status === 'awaiting' ? 'Awaiting confirmation' : 'Never confirmed' }}
                        </mat-chip>
                      </div>
                      <span class="domain">{{ req.email }}</span>
                      <span class="last-used">
                        {{ requestLabel(req) }}
                        <!-- The bucket the caps actually counted, not the
                             address as it arrived: an IPv6 client is stored as
                             its /64, because privacy extensions rotate the host
                             half hourly. Shown because "why was this person
                             refused" is the commonest reason to open this. -->
                        <span class="client-ip" [matTooltip]="ipTooltip(req)">{{
                          ipLabel(req)
                        }}</span>
                      </span>
                    </div>

                    <div class="actions">
                      <button
                        mat-icon-button
                        class="delete-btn"
                        (click)="cancelRequest(req)"
                        [attr.aria-label]="'Withdraw the demo request from ' + req.email"
                        matTooltip="Withdraw this request and free its slot"
                      >
                        <mat-icon>delete_forever</mat-icon>
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </section>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .tenants-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 16px;
      }
      .tenants-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }
      h2 {
        margin: 0;
      }
      .subtitle {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: rgba(0, 0, 0, 0.6);
        max-width: 60ch;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 40px;
      }

      .tenant-list {
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 10px;
        overflow: hidden;
        background: #fff;
      }
      .tenant-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.07);
      }
      .tenant-row:last-child {
        border-bottom: none;
      }
      .tenant-row.suspended {
        background: rgba(178, 106, 0, 0.05);
        border-left: 3px solid #b26a00;
      }

      /* Takes the slack, so long domains shrink rather than pushing the
         actions out of the row -- which is exactly what went wrong with the
         card layout this replaced. */
      .identity {
        flex: 1 1 auto;
        min-width: 0;
      }
      .name-line {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .slug {
        font-weight: 600;
        font-size: 15px;
      }
      .domain {
        display: block;
        margin-top: 2px;
        font-size: 12.5px;
        color: rgba(0, 0, 0, 0.6);
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .domain:hover {
        text-decoration: underline;
        color: var(--ce-primary);
      }

      .stats {
        display: flex;
        gap: 20px;
        flex: 0 0 auto;
      }
      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 58px;
      }
      .stat-value {
        font-size: 17px;
        font-weight: 600;
        line-height: 1.1;
      }
      .stat-label {
        font-size: 10px;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.5);
      }

      /* Never shrinks: the controls are the one part of the row that must stay
         where the eye expects them, and clipping them is how the previous
         layout hid the delete button. */
      .actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 0 auto;
      }
      .delete-btn {
        color: #b3261e;
      }
      /* Holds the delete slot open so Edit and People do not move between one
         community and the next, and carries the tooltip explaining why the
         action is unavailable here. */
      .action-placeholder {
        display: inline-block;
        width: 40px;
        height: 40px;
      }

      .chip-root,
      .chip-suspended {
        font-size: 11px !important;
        min-height: 22px !important;
        padding: 0 8px !important;
      }
      .chip-root {
        background: #e1e8f0 !important;
      }
      .chip-suspended {
        background: #ffe0b2 !important;
      }
      .chip-demo {
        background: #d7ccef !important;
      }
      .list-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }
      .sort-field {
        min-width: 190px;
      }
      .last-used {
        font-size: 12px;
        opacity: 0.7;
      }

      .single-note {
        margin: 16px 0 0;
        font-size: 12.5px;
        line-height: 1.6;
        color: rgba(0, 0, 0, 0.6);
      }

      /* Deliberately the same row shape as a community above, because it is
         the same kind of thing at an earlier stage -- somebody who will have a
         demo, or who was going to. Set apart by a heading and a lighter ground
         rather than by a different layout, so the eye does not have to learn a
         second list. */
      .demo-requests {
        margin-top: 28px;
      }
      .demo-requests h3 {
        margin: 0;
        font-size: 15px;
      }
      .demo-requests .subtitle {
        margin: 4px 0 12px;
      }
      .request-list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ce-rule);
        border-radius: 10px;
        overflow: hidden;
        background: var(--ce-surface);
      }
      .request-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--ce-rule);
      }
      .request-row:last-child {
        border-bottom: none;
      }
      /* A request nobody acted on is history, not work: recessed so the
         awaiting ones -- the only ones still holding a slot -- read first. */
      .request-row.lapsed {
        background: var(--ce-surface-variant);
      }
      .request-row.lapsed .slug,
      .request-row.lapsed .domain {
        color: var(--ce-text-muted);
      }
      .chip-awaiting,
      .chip-lapsed {
        font-size: 11px !important;
        min-height: 22px !important;
        padding: 0 8px !important;
      }
      .chip-awaiting {
        background: #d7ccef !important;
      }
      .chip-lapsed {
        background: #e4e4e4 !important;
      }
      /* Monospace and set off by a separator: an address is read character by
         character when two are being compared, which is the whole reason it is
         on screen. */
      .client-ip {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11.5px;
        color: var(--ce-text-muted);
      }
      .client-ip::before {
        content: '·';
        margin: 0 5px;
      }

      @media (max-width: 700px) {
        .tenants-header {
          flex-direction: column;
        }
        /* Stacks rather than scrolls sideways: the actions stay reachable on a
           phone, which is where an operator is most likely to be suspending
           something in a hurry. */
        .tenant-row {
          flex-wrap: wrap;
        }
        .identity {
          flex: 1 1 100%;
        }
        .stats {
          gap: 14px;
        }
      }
    `,
  ],
})
export class AdminTenantsComponent implements OnInit {
  private readonly tenantsAdminService = inject(TenantsAdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly tenants = signal<AdminTenant[]>([]);

  /**
   * Demo requests that produced no community, and how full the pool is.
   *
   * Loaded alongside the registry rather than behind a tab: the question these
   * answer -- "why are there no slots free" -- is asked while looking at the
   * list of demos, and a second click away is a screen nobody finds.
   */
  readonly demoRequests = signal<PendingDemoRequest[]>([]);
  readonly capacity = signal<DemoRequestList['capacity']>({ live: 0, awaiting: 0, max: 0 });

  /**
   * Which communities to show, and in what order.
   *
   * Both are view state and deliberately not persisted: an operator opening
   * this screen wants the whole registry, not whatever they were last looking
   * at. A remembered filter that hides half the communities is how somebody
   * concludes a community has been deleted.
   */
  readonly filter = signal<'all' | 'real' | 'demo'>('all');
  readonly sort = signal<'default' | 'expires' | 'lastUsed'>('default');

  readonly demoCount = computed(() => this.tenants().filter((t) => t.isDemo).length);
  readonly realCount = computed(() => this.tenants().filter((t) => !t.isDemo).length);

  /**
   * The list as filtered and sorted, which is what the template renders.
   *
   * Sorting is done here rather than by re-querying: the registry is a handful
   * of rows, already in memory, and a round trip per sort change would make the
   * control feel broken.
   *
   * **Missing values sort last in both orders, never first.** A community with
   * no expiry is not "expiring soonest" and one nobody has signed into is not
   * "most recently used" -- and the null case is the common one here, since
   * only demos expire at all.
   */
  readonly visibleTenants = computed<AdminTenant[]>(() => {
    const filter = this.filter();
    const rows = this.tenants().filter((t) =>
      filter === 'all' ? true : filter === 'demo' ? t.isDemo : !t.isDemo,
    );

    const byMissingLast = (a: string | null, b: string | null, newestFirst: boolean): number => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      const delta = new Date(a).getTime() - new Date(b).getTime();
      return newestFirst ? -delta : delta;
    };

    switch (this.sort()) {
      case 'expires':
        return [...rows].sort((a, b) => byMissingLast(a.demoExpiresAt, b.demoExpiresAt, false));
      case 'lastUsed':
        return [...rows].sort((a, b) => byMissingLast(a.lastActiveAt, b.lastActiveAt, true));
      default:
        // The API's own order: root first, then by slug. Left alone rather than
        // re-sorted, so "Name" means exactly what the unsorted list showed.
        return rows;
    }
  });

  /**
   * "3 days ago", or "Never". Relative because the question this answers is
   * "is anyone using this", and a date makes the reader do the subtraction.
   */
  lastUsedLabel(tenant: AdminTenant): string {
    if (!tenant.lastActiveAt) return 'Never signed in';
    const when = new Date(tenant.lastActiveAt).getTime();
    if (Number.isNaN(when)) return 'Never signed in';
    const days = Math.floor((Date.now() - when) / 86_400_000);
    if (days <= 0) return 'Active today';
    if (days === 1) return 'Active yesterday';
    return `Active ${days} days ago`;
  }
  readonly loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.tenantsAdminService.getAll().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Could not load communities', 'OK', { duration: 5000 });
      },
    });
    this.loadDemoRequests();
  }

  /**
   * Fetched separately and failing quietly.
   *
   * The registry is the screen; the demo requests are a footnote to it. A
   * failure here leaves the section unrendered rather than blanking the list
   * of communities or raising a second error toast beside the first.
   */
  private loadDemoRequests(): void {
    this.tenantsAdminService.getDemoRequests().subscribe({
      next: (res) => {
        this.demoRequests.set(res.requests);
        this.capacity.set(res.capacity);
      },
      error: () => {
        this.demoRequests.set([]);
      },
    });
  }

  openCreate(): void {
    this.openDialog({});
  }

  openEdit(tenant: AdminTenant): void {
    this.openDialog({ tenant });
  }

  openUsers(tenant: AdminTenant): void {
    // Reloads on close: adding or suspending someone changes the member count
    // shown on the card behind it.
    this.dialog
      .open(TenantUsersDialogComponent, { data: { tenant } })
      .afterClosed()
      .subscribe(() => this.load());
  }

  /**
   * "Demo - expires 26 Sep", or just "Demo" if the date is missing.
   *
   * The date is the useful half: an operator looking at ten hex-named rows
   * wants to know which are about to clear themselves and which they might
   * actually want to remove now.
   */
  demoLabel(tenant: AdminTenant): string {
    if (!tenant.demoExpiresAt) return 'Demo';
    const when = new Date(tenant.demoExpiresAt);
    if (Number.isNaN(when.getTime())) return 'Demo';
    return `Demo — expires ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  }

  /**
   * "Asked 2 hours ago — link expires in 22 hours", or "— link expired".
   *
   * Both halves matter and they are different questions. When they asked says
   * whether this is somebody currently trying to get in; whether the link is
   * still good says whether the request is holding a slot.
   */
  requestLabel(req: PendingDemoRequest): string {
    const asked = new Date(req.requestedAt).getTime();
    const when = Number.isNaN(asked) ? 'Requested' : `Asked ${this.ago(asked)}`;
    if (req.status === 'lapsed') return `${when} — link expired`;

    const left = new Date(req.expiresAt).getTime() - Date.now();
    if (Number.isNaN(left)) return when;
    const hours = Math.max(1, Math.round(left / 3_600_000));
    return `${when} — link expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  }

  /**
   * The address the caps counted this request under.
   *
   * Not always the address the request arrived from, and the difference is
   * worth being honest about on screen: an IPv6 client is stored as its /64,
   * because privacy extensions hand it a fresh host portion as often as hourly
   * and counting the whole address would mean the cap never binds. What is
   * shown is therefore the bucket, which is what an operator comparing two
   * refusals needs.
   *
   * A missing address is said plainly rather than left blank — blank reads as
   * a rendering fault, and "no address recorded" is a real state: a request
   * that reached the API with no usable client IP is counted against the pool
   * cap only.
   */
  ipLabel(req: PendingDemoRequest): string {
    if (!req.ipAddress) return 'no address recorded';
    return req.ipAddress.endsWith('::') ? `${req.ipAddress}/64` : req.ipAddress;
  }

  ipTooltip(req: PendingDemoRequest): string {
    if (!req.ipAddress) {
      return 'This request arrived with no usable client address, so only the total pool cap applied to it.';
    }
    return req.ipAddress.endsWith('::')
      ? 'The IPv6 allocation this request came from. Addresses within it rotate, so the cap counts the /64 rather than the single address.'
      : 'The address this request came from, as the per-IP cap counted it.';
  }

  /** Relative and coarse: this is a "roughly when", not a timestamp. */
  private ago(at: number): string {
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /**
   * Withdraws one request, freeing its slot.
   *
   * Confirmed, but not behind a retyped anything: what goes is a row and an
   * unused link, and the person can ask again. Reloads everything afterwards
   * because the slot count on both sections moves.
   */
  cancelRequest(req: PendingDemoRequest): void {
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Withdraw this demo request?',
          message:
            `${req.email} asked for a demo and has not set it up. Withdrawing frees the slot ` +
            `and stops their link working. They can ask again.`,
          confirmLabel: 'Withdraw',
          confirmColor: 'warn',
        } satisfies ConfirmDialogData,
      })
      .afterClosed()
      .subscribe((confirmed?: boolean) => {
        if (!confirmed) return;
        this.tenantsAdminService.cancelDemoRequest(req.id).subscribe({
          next: () => {
            this.snackBar.open('Demo request withdrawn', 'OK', { duration: 4000 });
            this.load();
          },
          error: () => this.snackBar.open('Could not withdraw that request', 'OK', { duration: 5000 }),
        });
      });
  }

  openDelete(tenant: AdminTenant): void {
    this.dialog
      .open(TenantDeleteDialogComponent, { data: { tenant } })
      .afterClosed()
      .subscribe((deleted?: boolean) => {
        if (deleted) this.load();
      });
  }

  private openDialog(data: TenantFormDialogData): void {
    this.dialog
      .open(TenantFormDialogComponent, { data })
      .afterClosed()
      .subscribe((saved?: AdminTenant) => {
        // Reload rather than patching the row in place: the counts come from the
        // server and a slug change reorders the list.
        if (saved) this.load();
      });
  }
}
