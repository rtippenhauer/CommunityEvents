import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { DatePipe, JsonPipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * One row of the email log (v2-31).
 *
 * Bodies and template params are **not** here: `htmlBody` is LongText, so
 * carrying it on every row made the response grow with the community's mail
 * rather than with the page. `EmailLogContent` is fetched for the single row
 * somebody expands.
 */
interface EmailLogRow {
  id: number;
  toEmail: string;
  toName: string | null;
  subject: string | null;
  templateId: string | null;
  status: string;
  provider: string | null;
  attempts: number;
  priority: number;
  lastAttemptAt: string | null;
  errorMessage: string | null;
  brevoStatus: string | null;
  sendAfter: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface EmailLogPage {
  rows: EmailLogRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** Per-status totals for the whole community, ignoring filters and paging. */
  counts: Record<string, number>;
}

interface EmailLogContent {
  id: number;
  templateParams: Record<string, unknown> | null;
  htmlBody: string | null;
  textBody: string | null;
}

/**
 * The viewer's own day, for the date filters.
 *
 * A `MatDatepicker` hands back a Date at local midnight of the chosen day,
 * which is already the start; the end is the last instant of it. Both are sent
 * as ISO instants, so the range an admin picks is the range in their own
 * calendar day rather than in the server's — the API would read a bare
 * `YYYY-MM-DD` as UTC, which is an hours-wide disagreement about "today" for
 * anyone outside it.
 */
function startOfLocalDay(day: Date): Date {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfLocalDay(day: Date): Date {
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * What a PATCH may send. Distinct from EmailConfig because the two API keys are
 * write-only: they go up, they never come back down.
 */
type EmailConfigPatch = Partial<Omit<EmailConfig, 'brevoApiKeySet' | 'resendApiKeySet'>> & {
  brevoApiKey?: string | null;
  resendApiKey?: string | null;
};

/** GET /admin/email/quota-window -- the sending day, and what Brevo says. */
interface EmailQuotaWindow {
  timeZone: string;
  windowStartedAt: string;
  windowEndsAt: string;
  /** Null when there is no key, Brevo did not answer, or the plan is prepaid. */
  providerRemaining: number | null;
  providerPlan: string | null;
  providerAccountId: string | null;
  providerCheckedAt: string | null;
}

interface EmailConfig {
  id: number;
  brevoEnabled: boolean;
  resendOverflowEnabled: boolean;
  brevoDailyLimit: number;
  resendDailyLimit: number;
  brevoSentToday: number;
  resendSentToday: number;
  lastResetDate: string;
  // credentials. The API keys themselves are never sent to the browser -- they
  // are encrypted at rest and the endpoint answers with whether one is stored
  // (v2-7). An empty key field therefore means "leave the stored key alone",
  // not "clear it"; clearing is the explicit Remove button.
  brevoApiKeySet: boolean;
  /**
   * Whether this community may send on the deployment's own Brevo account when
   * it has set no key (v2-12). False for a community on its own domain, where
   * an empty key field means "cannot send at all" rather than "inheriting".
   */
  mayUseDeploymentCredentials: boolean;
  // Deliverability callbacks. The token itself never reaches the browser --
  // it is minted server-side, handed to Brevo through their API and stored
  // encrypted, so the screen only ever learns whether one is registered.
  webhookRegistered: boolean;
  webhookRotatedAt: string | null;
  webhookError: string | null;
  // Brevo deactivates a key after 90 days of inactivity, so a community that
  // has gone quiet is heading for a broken key with nothing here changing.
  brevoApiKeySetAt: string | null;
  lastSuccessfulSendAt: string | null;
  brevoFromEmail: string | null;
  brevoFromName: string | null;
  resendApiKeySet: boolean;
  resendFromEmail: string | null;
  resendFromName: string | null;
  // template IDs
  tmplInvite: number | null;
  tmplSecurityAlert: number | null;
  tmplEventPublished: number | null;
  tmplRsvpConfirmation: number | null;
  tmplEventReminder: number | null;
  tmplAccountDeletion: number | null;
  tmplReengagement60: number | null;
  tmplReengagement90: number | null;
  tmplGuestRsvpConfirmation: number | null;
  tmplEmailVerification: number | null;
  tmplPasswordReset: number | null;
}

@Component({
  selector: 'app-admin-email',
  standalone: true,
  imports: [
    DatePipe,
    JsonPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatDividerModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  template: `
    <div class="email-admin-container">
      <h2 class="page-title">Email Admin</h2>

      @if (config(); as cfg) {
        <!-- Send counts card -->
        <mat-card>
          <mat-card-header>
            <mat-card-title>Today's Send Counts</mat-card-title>
            <div class="header-actions">
              @if (failedCount() > 0) {
                <button
                  mat-stroked-button
                  color="warn"
                  (click)="retryFailed()"
                  [disabled]="retrying()"
                >
                  <mat-icon>replay</mat-icon> Retry {{ failedCount() }} Failed
                </button>
              }
              <button
                mat-stroked-button
                color="primary"
                (click)="flushQueue()"
                [disabled]="flushing()"
              >
                <mat-icon>send</mat-icon> {{ flushing() ? 'Sending…' : 'Send Now' }}
              </button>
              <button mat-icon-button (click)="loadLog()" matTooltip="Refresh queue">
                <mat-icon>refresh</mat-icon>
              </button>
            </div>
          </mat-card-header>
          <mat-card-content>
            <div class="provider-grid">
              <div class="provider-block">
                <div class="provider-header">
                  <span class="provider-name">Brevo</span>
                  <mat-slide-toggle
                    [checked]="cfg.brevoEnabled"
                    (change)="patchConfig({ brevoEnabled: $event.checked })"
                  />
                </div>
                <div class="provider-stat">
                  <span>This community sent</span>
                  <strong>{{ cfg.brevoSentToday }} / {{ cfg.brevoDailyLimit }}</strong>
                </div>
                @if (quota(); as q) {
                  @if (q.providerRemaining !== null) {
                    <div class="provider-stat">
                      <span>Account has left</span>
                      <strong>{{ q.providerRemaining }}</strong>
                    </div>
                  }
                }
                <div class="provider-stat">
                  <span>Counting since</span>
                  <strong>{{ cfg.lastResetDate | date: 'MMM d, h:mm a' }}</strong>
                </div>
              </div>
              <div class="provider-block">
                <div class="provider-header">
                  <span class="provider-name">Resend (overflow)</span>
                  <mat-slide-toggle
                    [checked]="cfg.resendOverflowEnabled"
                    (change)="patchConfig({ resendOverflowEnabled: $event.checked })"
                  />
                </div>
                <div class="provider-stat">
                  <span>Sent today</span>
                  <strong>{{ cfg.resendSentToday }} / {{ cfg.resendDailyLimit }}</strong>
                </div>
              </div>
            </div>
            @if (quota(); as q) {
              <p class="counter-note">
                The sending day rolls over at midnight {{ q.timeZone }} —
                {{ q.windowEndsAt | date: 'h:mm a' }} where you are — and both counts start
                again then.
                @if (q.providerRemaining !== null) {
                  The two numbers answer different questions. The first is what this community
                  sent. The second is what the Brevo <em>account</em> has left — and any
                  community without its own API key sends on the same account, so that
                  allowance is shared. It is the one that decides whether a message goes out.
                } @else if (q.providerPlan) {
                  Brevo reports a {{ q.providerPlan }} balance rather than a daily allowance,
                  so there is no daily figure to hold sending against.
                }
              </p>
            }
          </mat-card-content>
        </mat-card>

        <!-- Credentials & Templates (expansion panel) -->
        <mat-accordion>
          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>Brevo Credentials</mat-panel-title>
              <mat-panel-description>API key, sender address</mat-panel-description>
            </mat-expansion-panel-header>
            <form [formGroup]="brevoForm" (ngSubmit)="saveBrevo()" class="creds-form">
              @if (cannotSend()) {
                <p class="webhook-state failed">
                  <mat-icon>error_outline</mat-icon>
                  This community is on its own domain, so it does not send on this
                  deployment's Brevo account — it needs a key of its own. Until one is set
                  here, nothing can be mailed: no invitations, no address verifications and
                  no password resets, which between them are the only ways to join this
                  community or get back into it.
                </p>
              }
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>API Key</mat-label>
                <input matInput formControlName="brevoApiKey" type="password" autocomplete="off" />
                <mat-hint>
                  @if (config()?.brevoApiKeySet) {
                    A key is stored — leave blank to keep it.
                    @if (config()?.brevoApiKeySetAt) {
                      Set {{ config()!.brevoApiKeySetAt | date: 'MMM d, y' }}.
                    }
                  } @else if (config()?.mayUseDeploymentCredentials) {
                    Not set; falls back to the BREVO_API_KEY env var.
                  } @else {
                    Required — this community has no deployment account to fall back on.
                  }
                </mat-hint>
              </mat-form-field>
              <div class="two-col">
                <mat-form-field appearance="outline">
                  <mat-label>From Email</mat-label>
                  <input matInput formControlName="brevoFromEmail" type="email" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>From Name</mat-label>
                  <input matInput formControlName="brevoFromName" />
                </mat-form-field>
              </div>
              <div class="cred-actions">
                <button mat-raised-button color="primary" type="submit" [disabled]="saving()">
                  Save Brevo Credentials
                </button>
                @if (config()?.brevoApiKeySet) {
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="saving()"
                    (click)="removeKey('brevo')"
                  >
                    Remove stored key
                  </button>
                }
              </div>
            </form>

            <div class="webhook-block">
              <h4>Deliverability webhook</h4>
              <p class="webhook-help">
                Brevo tells this community when a message bounces or somebody unsubscribes, so
                the address stops being mailed. Registering sets it up in your Brevo account —
                there is nothing to copy, and the token is rotated automatically from then on.
              </p>

              @if (config()?.webhookRegistered) {
                <p class="webhook-state ok">
                  <mat-icon>check_circle</mat-icon>
                  Registered
                  @if (config()?.webhookRotatedAt) {
                    <span> — token last changed {{ config()!.webhookRotatedAt | date: 'MMM d, y' }}</span>
                  }
                </p>
              } @else {
                <p class="webhook-state">
                  <mat-icon>error_outline</mat-icon>
                  Not registered — bounces are not being recorded for this community.
                </p>
              }

              @if (config()?.webhookError) {
                <p class="webhook-state failed">Last attempt failed: {{ config()!.webhookError }}</p>
              }

              @if (sendingHasGoneQuiet()) {
                <p class="webhook-state failed">
                  Brevo deactivates an API key after 90 days without use, and this community
                  @if (config()?.lastSuccessfulSendAt) {
                    has not sent since {{ config()!.lastSuccessfulSendAt | date: 'MMM d, y' }}.
                  } @else {
                    has not sent anything yet.
                  }
                  Send something, or expect the key to stop working.
                </p>
              }

              <button
                mat-stroked-button
                type="button"
                [disabled]="registeringWebhook() || !config()"
                (click)="registerWebhook()"
              >
                @if (registeringWebhook()) {
                  <mat-spinner diameter="18" />
                } @else {
                  {{ config()?.webhookRegistered ? 'Re-register webhook' : 'Register webhook' }}
                }
              </button>
            </div>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>Resend Credentials</mat-panel-title>
              <mat-panel-description>API key and sender address for overflow</mat-panel-description>
            </mat-expansion-panel-header>
            <form [formGroup]="resendForm" (ngSubmit)="saveResend()" class="creds-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>API Key</mat-label>
                <input matInput formControlName="resendApiKey" type="password" autocomplete="off" />
                <mat-hint>
                  @if (config()?.resendApiKeySet) {
                    A key is stored — leave blank to keep it.
                  } @else {
                    Not set; falls back to the RESEND_API_KEY env var.
                  }
                </mat-hint>
              </mat-form-field>
              <div class="two-col">
                <mat-form-field appearance="outline">
                  <mat-label>From Email</mat-label>
                  <input matInput formControlName="resendFromEmail" type="email" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>From Name</mat-label>
                  <input matInput formControlName="resendFromName" />
                </mat-form-field>
              </div>
              <div class="cred-actions">
                <button mat-raised-button color="primary" type="submit" [disabled]="saving()">
                  Save Resend Credentials
                </button>
                @if (config()?.resendApiKeySet) {
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="saving()"
                    (click)="removeKey('resend')"
                  >
                    Remove stored key
                  </button>
                }
              </div>
            </form>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>Brevo Template IDs</mat-panel-title>
              <mat-panel-description
                >Numeric IDs from your Brevo template library</mat-panel-description
              >
            </mat-expansion-panel-header>
            <form [formGroup]="templatesForm" (ngSubmit)="saveTemplates()" class="creds-form">
              <div class="templates-grid">
                <mat-form-field appearance="outline">
                  <mat-label>Invite</mat-label>
                  <input matInput formControlName="tmplInvite" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Security Alert</mat-label>
                  <input matInput formControlName="tmplSecurityAlert" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Event Published</mat-label>
                  <input matInput formControlName="tmplEventPublished" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>RSVP Confirmation</mat-label>
                  <input matInput formControlName="tmplRsvpConfirmation" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Event Reminder</mat-label>
                  <input matInput formControlName="tmplEventReminder" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Account Deletion Warning</mat-label>
                  <input matInput formControlName="tmplAccountDeletion" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Re-engagement (60 day)</mat-label>
                  <input matInput formControlName="tmplReengagement60" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Re-engagement (90 day)</mat-label>
                  <input matInput formControlName="tmplReengagement90" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Guest RSVP Confirmation</mat-label>
                  <input
                    matInput
                    formControlName="tmplGuestRsvpConfirmation"
                    type="number"
                    min="0"
                  />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Email Verification</mat-label>
                  <input matInput formControlName="tmplEmailVerification" type="number" min="0" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Password Reset</mat-label>
                  <input matInput formControlName="tmplPasswordReset" type="number" min="0" />
                </mat-form-field>
              </div>
              <button mat-raised-button color="primary" type="submit" [disabled]="saving()">
                Save Template IDs
              </button>
            </form>
          </mat-expansion-panel>
        </mat-accordion>

        <!-- The log. Named for what it is: every message this community has
             sent or tried to, with the queue visible inside it as two statuses
             rather than as a separate screen. -->
        <mat-card>
          <mat-card-header>
            <mat-card-title>Email Log</mat-card-title>
            <mat-card-subtitle>
              Everything this community has sent. {{ pendingCount() }} waiting,
              {{ failedCount() }} failed.
            </mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="log-filters">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search-field">
                <mat-label>Search</mat-label>
                <input
                  matInput
                  [value]="search()"
                  (input)="onSearchInput($any($event.target).value)"
                  placeholder="Recipient, name or subject"
                />
                <mat-icon matPrefix>search</mat-icon>
              </mat-form-field>

              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="status-field">
                <mat-label>Status</mat-label>
                <mat-select
                  [value]="statusFilter()"
                  (selectionChange)="statusFilter.set($event.value); applyFilters()"
                >
                  <mat-option value="">Any status</mat-option>
                  <mat-option value="sent">Sent</mat-option>
                  <mat-option value="pending">Pending</mat-option>
                  <mat-option value="failed">Failed</mat-option>
                  <mat-option value="cancelled">Cancelled</mat-option>
                  <mat-option value="blocked">Blocked</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="date-field">
                <mat-label>From</mat-label>
                <input
                  matInput
                  [matDatepicker]="fromPicker"
                  [value]="fromDate()"
                  (dateChange)="fromDate.set($event.value); applyFilters()"
                />
                <mat-datepicker-toggle matIconSuffix [for]="fromPicker" />
                <mat-datepicker #fromPicker />
              </mat-form-field>

              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="date-field">
                <mat-label>To</mat-label>
                <input
                  matInput
                  [matDatepicker]="toPicker"
                  [value]="toDate()"
                  (dateChange)="toDate.set($event.value); applyFilters()"
                />
                <mat-datepicker-toggle matIconSuffix [for]="toPicker" />
                <mat-datepicker #toPicker />
              </mat-form-field>

              @if (hasFilters()) {
                <button mat-button (click)="clearFilters()">
                  <mat-icon>clear</mat-icon> Clear
                </button>
              }
            </div>

            @if (loading()) {
              <mat-spinner diameter="28" />
            } @else if (queue().length === 0) {
              <!-- Two different nothings, and conflating them is how somebody
                   concludes no mail was ever sent. -->
              <p class="empty-state">
                @if (hasFilters()) {
                  No messages match those filters.
                } @else {
                  This community has not sent any email yet.
                }
              </p>
            } @else {
              <table mat-table [dataSource]="queue()" class="queue-table" multiTemplateDataRows>
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>Status</th>
                  <td mat-cell *matCellDef="let row">
                    <mat-chip [class]="'chip-' + row.status">{{ row.status }}</mat-chip>
                  </td>
                </ng-container>
                <ng-container matColumnDef="template">
                  <th mat-header-cell *matHeaderCellDef>Template</th>
                  <td mat-cell *matCellDef="let row">{{ row.templateId ?? '—' }}</td>
                </ng-container>
                <ng-container matColumnDef="toEmail">
                  <th mat-header-cell *matHeaderCellDef>To</th>
                  <td mat-cell *matCellDef="let row">{{ row.toEmail }}</td>
                </ng-container>
                <ng-container matColumnDef="provider">
                  <th mat-header-cell *matHeaderCellDef>Provider</th>
                  <td mat-cell *matCellDef="let row">{{ row.provider ?? '—' }}</td>
                </ng-container>
                <ng-container matColumnDef="attempts">
                  <th mat-header-cell *matHeaderCellDef>Tries</th>
                  <td mat-cell *matCellDef="let row">{{ row.attempts }}</td>
                </ng-container>
                <ng-container matColumnDef="createdAt">
                  <th mat-header-cell *matHeaderCellDef>Created</th>
                  <td mat-cell *matCellDef="let row">{{ row.createdAt | date: 'short' }}</td>
                </ng-container>
                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let row">
                    <button mat-icon-button (click)="toggleDetail(row.id)" matTooltip="More info">
                      <mat-icon>{{
                        expandedRowId() === row.id ? 'expand_less' : 'expand_more'
                      }}</mat-icon>
                    </button>
                    @if (row.status === 'pending' || row.status === 'failed') {
                      <button
                        mat-icon-button
                        color="warn"
                        (click)="cancelEmail(row.id)"
                        matTooltip="Cancel"
                      >
                        <mat-icon>cancel</mat-icon>
                      </button>
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="expandedDetail">
                  <td mat-cell *matCellDef="let row" [attr.colspan]="displayedColumns.length">
                    @if (expandedRowId() === row.id) {
                      <div class="row-detail">
                        <div class="detail-field">
                          <span>Subject</span><strong>{{ row.subject ?? '—' }}</strong>
                        </div>
                        <div class="detail-field">
                          <span>Last attempt</span
                          ><strong>{{
                            row.lastAttemptAt ? (row.lastAttemptAt | date: 'short') : '—'
                          }}</strong>
                        </div>
                        @if (row.brevoStatus) {
                          <div class="detail-field">
                            <span>Brevo status</span><strong>{{ row.brevoStatus }}</strong>
                          </div>
                        }
                        @if (row.errorMessage) {
                          <div class="detail-field">
                            <span>Error</span
                            ><strong class="detail-error">{{ row.errorMessage }}</strong>
                          </div>
                        }
                        <!-- Content is fetched on expand rather than carried on
                             every row: html_body is LongText, so including it in
                             the list made the response grow with the community's
                             mail instead of with the page. -->
                        @if (loadingContent()) {
                          <mat-spinner diameter="20" />
                        } @else if (expandedContent(); as content) {
                          @if (content.templateParams) {
                            <div class="detail-block">
                              <span>Template params</span>
                              <pre>{{ content.templateParams | json }}</pre>
                            </div>
                          }
                          @if (content.htmlBody) {
                            <div class="detail-block">
                              <span>HTML body (source)</span>
                              <pre class="detail-body">{{ content.htmlBody }}</pre>
                            </div>
                          }
                          @if (content.textBody) {
                            <div class="detail-block">
                              <span>Text body</span>
                              <pre class="detail-body">{{ content.textBody }}</pre>
                            </div>
                          }
                          @if (!content.templateParams && !content.htmlBody && !content.textBody) {
                            <p class="empty-state">
                              No stored content for this email — it may have been sent via provider
                              template only.
                            </p>
                          }
                        }
                      </div>
                    }
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
                <tr
                  mat-row
                  *matRowDef="let row; columns: ['expandedDetail']"
                  class="detail-row"
                ></tr>
              </table>

              <!-- Hand-rolled rather than MatPaginator: the server owns the
                   paging, so the component holds page/total already and
                   MatPaginator would be a second copy of that state to keep in
                   step. It also lets the range read in plain words. -->
              <div class="log-pager">
                <span class="range">
                  Showing {{ rangeStart() }}–{{ rangeEnd() }} of {{ total() }}
                </span>

                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="size-field">
                  <mat-label>Per page</mat-label>
                  <mat-select [value]="pageSize()" (selectionChange)="setPageSize($event.value)">
                    <mat-option [value]="25">25</mat-option>
                    <mat-option [value]="50">50</mat-option>
                    <mat-option [value]="100">100</mat-option>
                    <mat-option [value]="200">200</mat-option>
                  </mat-select>
                </mat-form-field>

                <div class="pager-buttons">
                  <button
                    mat-icon-button
                    [disabled]="page() <= 1"
                    (click)="goToPage(1)"
                    matTooltip="First page"
                    aria-label="First page"
                  >
                    <mat-icon>first_page</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    [disabled]="page() <= 1"
                    (click)="goToPage(page() - 1)"
                    matTooltip="Previous page"
                    aria-label="Previous page"
                  >
                    <mat-icon>chevron_left</mat-icon>
                  </button>
                  <span class="page-of">Page {{ page() }} of {{ pages() }}</span>
                  <button
                    mat-icon-button
                    [disabled]="page() >= pages()"
                    (click)="goToPage(page() + 1)"
                    matTooltip="Next page"
                    aria-label="Next page"
                  >
                    <mat-icon>chevron_right</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    [disabled]="page() >= pages()"
                    (click)="goToPage(pages())"
                    matTooltip="Last page"
                    aria-label="Last page"
                  >
                    <mat-icon>last_page</mat-icon>
                  </button>
                </div>
              </div>
            }
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-spinner diameter="40" />
        <p class="loading-note">Loading email settings…</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .counter-note {
        margin: 10px 0 0;
        color: #777;
        font-size: 0.78rem;
        line-height: 1.4;
      }
      .loading-note {
        color: #888;
        font-size: 0.85rem;
        margin-top: 8px;
      }
      .email-admin-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 24px 16px;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .page-title {
        margin: 0;
        font-size: 1.4rem;
      }
      mat-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
      .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .provider-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        padding-top: 8px;
      }
      @media (max-width: 600px) {
        .provider-grid {
          grid-template-columns: 1fr;
        }
      }
      .provider-block {
        background: #f9f9f9;
        border-radius: 8px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .provider-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .provider-name {
        font-weight: 600;
        font-size: 0.95rem;
      }
      .provider-stat {
        display: flex;
        justify-content: space-between;
        font-size: 0.85rem;
        color: #555;
      }
      .creds-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px 0 8px;
      }
      .webhook-block {
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        padding-top: 16px;
        margin-top: 8px;

        h4 {
          margin: 0 0 4px;
          font-size: 0.95rem;
        }
      }
      .webhook-help {
        margin: 0 0 12px;
        color: #666;
        font-size: 0.82rem;
      }
      .webhook-state {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 12px;
        font-size: 0.85rem;
        color: #8a6d3b;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &.ok {
          color: #38603a;
        }

        &.failed {
          color: #c62828;
        }
      }
      .cred-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }
      .full-width {
        width: 100%;
      }
      .two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      @media (max-width: 600px) {
        .two-col {
          grid-template-columns: 1fr;
        }
      }
      .templates-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      @media (max-width: 600px) {
        .templates-grid {
          grid-template-columns: 1fr;
        }
      }
      .queue-table {
        width: 100%;
      }

      /* Wraps rather than scrolling sideways: four filters plus a Clear button
         will not fit a phone in one row, and a horizontally scrolling filter bar
         hides the controls it exists to offer. */
      .log-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .search-field {
        flex: 1 1 240px;
        min-width: 200px;
      }
      .status-field {
        flex: 0 0 160px;
      }
      .date-field {
        flex: 0 0 160px;
      }

      .log-pager {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 14px;
      }
      .log-pager .range {
        font-size: 12.5px;
        color: var(--ce-text-muted);
      }
      .size-field {
        flex: 0 0 110px;
      }
      .pager-buttons {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .page-of {
        font-size: 12.5px;
        padding: 0 8px;
        white-space: nowrap;
      }
      .detail-row td {
        border-bottom-width: 1px;
        padding: 0 !important;
      }
      .row-detail {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 16px;
        background: #f5f5f5;
      }
      .detail-field {
        display: flex;
        gap: 8px;
        font-size: 0.85rem;
      }
      .detail-field span {
        color: #777;
        min-width: 110px;
      }
      .detail-error {
        color: #c62828;
      }
      .detail-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.85rem;
      }
      .detail-block span {
        color: #777;
      }
      .detail-block pre {
        margin: 0;
        max-height: 240px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 8px;
        font-size: 0.78rem;
      }
      .empty-state {
        color: #999;
        text-align: center;
        padding: 24px 0;
      }
      mat-chip {
        font-size: 0.72rem !important;
        min-height: 22px !important;
      }
      .chip-pending {
        background: #fff9c4 !important;
      }
      .chip-sent {
        background: #c8e6c9 !important;
      }
      .chip-failed {
        background: #ffccbc !important;
      }
      .chip-cancelled,
      .chip-blocked {
        background: #e0e0e0 !important;
      }
    `,
  ],
})
export class AdminEmailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly queue = signal<EmailLogRow[]>([]);
  readonly config = signal<EmailConfig | null>(null);
  readonly loading = signal(false);
  readonly retrying = signal(false);
  readonly flushing = signal(false);
  readonly saving = signal(false);
  readonly registeringWebhook = signal(false);

  /**
   * The sending window, and Brevo's own count, once they arrive.
   *
   * Null until then, and null forever if Brevo cannot be reached -- which is
   * why it is a second request rather than part of the config: the settings on
   * this screen must render whether or not the provider answers, and this one
   * makes an outbound call.
   *
   * Worth showing at all because the boundary is genuinely surprising. It was
   * UTC midnight, which for a US operator is the early evening, so two sends a
   * few hours apart could leave the card reading 1 of 300 twice over. Naming
   * the zone and the local time it falls at is what makes the number readable.
   */
  readonly quota = signal<EmailQuotaWindow | null>(null);

  /**
   * Whether this community is close to Brevo's inactivity cutoff.
   *
   * Sixty days, not ninety: a warning that arrives on the day the key dies is
   * not a warning. Measured from the last successful send, or from when the key
   * was set if there has never been one -- a key that has never sent is on the
   * same clock as one that has gone quiet.
   */
  readonly sendingHasGoneQuiet = computed<boolean>(() => {
    const cfg = this.config();
    if (!cfg?.brevoApiKeySet) return false;
    const since = cfg.lastSuccessfulSendAt ?? cfg.brevoApiKeySetAt;
    if (!since) return false;
    return Date.now() - new Date(since).getTime() > 60 * 24 * 60 * 60 * 1000;
  });
  /**
   * Whether this community can send no mail at all (v2-12).
   *
   * True only for a community on its own domain with no key of its own: it has
   * no deployment account to fall back on. Distinct from "no key set", which is
   * an ordinary, working state for a community on a subdomain of this
   * deployment -- the whole reason the API reports which kind this is rather
   * than letting the screen guess from an empty field.
   */
  readonly cannotSend = computed<boolean>(() => {
    const cfg = this.config();
    return !!cfg && !cfg.brevoApiKeySet && !cfg.mayUseDeploymentCredentials;
  });

  /**
   * From the server, not from the loaded rows (v2-31).
   *
   * It used to be `queue().filter(...).length`, which was right only while every
   * row was loaded. Under pagination that quietly becomes "failed on this page",
   * so a second page of failures would report none and the Retry button would
   * vanish with work still outstanding.
   */
  readonly failedCount = computed(() => this.counts()['failed'] ?? 0);
  readonly pendingCount = computed(() => this.counts()['pending'] ?? 0);

  readonly expandedRowId = signal<number | null>(null);
  /** The expanded row's body, fetched on demand and cached per row. */
  readonly expandedContent = signal<EmailLogContent | null>(null);
  readonly loadingContent = signal(false);

  // ── The log's filters and page ──────────────────────────────────────────
  // View state, not persisted: an admin opening this screen wants the whole log
  // newest-first, not whatever they last searched for.
  readonly search = signal('');
  readonly statusFilter = signal<string>('');
  readonly fromDate = signal<Date | null>(null);
  readonly toDate = signal<Date | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly total = signal(0);
  readonly pages = signal(1);
  readonly counts = signal<Record<string, number>>({});

  readonly hasFilters = computed(
    () => !!this.search() || !!this.statusFilter() || !!this.fromDate() || !!this.toDate(),
  );

  /** Debounces typing, so a search is one request rather than one per keystroke. */
  private searchDebounce?: ReturnType<typeof setTimeout>;

  readonly displayedColumns = [
    'status',
    'template',
    'toEmail',
    'provider',
    'attempts',
    'createdAt',
    'actions',
  ];

  /**
   * Asks the API to register this community's webhook in Brevo.
   *
   * The server mints the token, calls Brevo with this community's own key and
   * host, and stores the result -- nothing is copied by hand, and the token
   * never reaches this screen. A failure is reported rather than thrown: the
   * usual cause is a revoked API key, which the operator has to fix in Brevo.
   */
  registerWebhook(): void {
    this.registeringWebhook.set(true);
    this.http
      .post<{ ok: boolean; error?: string }>('/api/v1/admin/email/webhook/register', {})
      .subscribe({
        next: (res) => {
          this.registeringWebhook.set(false);
          this.loadConfig();
          this.snackBar.open(
            res.ok ? 'Webhook registered with Brevo' : (res.error ?? 'Registration failed'),
            'OK',
            { duration: res.ok ? 3000 : 6000 },
          );
        },
        error: () => {
          this.registeringWebhook.set(false);
          this.loadConfig();
          this.snackBar.open('Registration failed', 'OK', { duration: 6000 });
        },
      });
  }

  readonly brevoForm = this.fb.group({
    brevoApiKey: [''],
    brevoFromEmail: [''],
    brevoFromName: [''],
  });

  readonly resendForm = this.fb.group({
    resendApiKey: [''],
    resendFromEmail: [''],
    resendFromName: [''],
  });

  readonly templatesForm = this.fb.group({
    tmplInvite: [null as number | null],
    tmplSecurityAlert: [null as number | null],
    tmplEventPublished: [null as number | null],
    tmplRsvpConfirmation: [null as number | null],
    tmplEventReminder: [null as number | null],
    tmplAccountDeletion: [null as number | null],
    tmplReengagement60: [null as number | null],
    tmplReengagement90: [null as number | null],
    tmplGuestRsvpConfirmation: [null as number | null],
    tmplEmailVerification: [null as number | null],
    tmplPasswordReset: [null as number | null],
  });

  ngOnInit(): void {
    this.loadConfig();
    this.loadLog();
    this.loadQuotaWindow();
  }

  /**
   * Asks the API what the sending window is and what Brevo says is left of it.
   *
   * Failure is silent on purpose -- no snackbar. Everything this fills in is a
   * cross-check on numbers already shown, so a provider that does not answer
   * should cost the reader a line of explanation, not an error they cannot act
   * on and did not ask for.
   */
  loadQuotaWindow(): void {
    this.http.get<EmailQuotaWindow>('/api/v1/admin/email/quota-window').subscribe({
      next: (quota) => this.quota.set(quota),
      error: () => this.quota.set(null),
    });
  }

  loadConfig(): void {
    this.http.get<EmailConfig>('/api/v1/admin/email/config').subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        // The key fields are deliberately left blank: the API no longer sends
        // the stored value, and blank is what "keep the existing key" looks
        // like on save.
        this.brevoForm.patchValue({
          brevoFromEmail: cfg.brevoFromEmail ?? '',
          brevoFromName: cfg.brevoFromName ?? '',
        });
        this.resendForm.patchValue({
          resendFromEmail: cfg.resendFromEmail ?? '',
          resendFromName: cfg.resendFromName ?? '',
        });
        this.templatesForm.patchValue({
          tmplInvite: cfg.tmplInvite,
          tmplSecurityAlert: cfg.tmplSecurityAlert,
          tmplEventPublished: cfg.tmplEventPublished,
          tmplRsvpConfirmation: cfg.tmplRsvpConfirmation,
          tmplEventReminder: cfg.tmplEventReminder,
          tmplAccountDeletion: cfg.tmplAccountDeletion,
          tmplReengagement60: cfg.tmplReengagement60,
          tmplReengagement90: cfg.tmplReengagement90,
          tmplGuestRsvpConfirmation: cfg.tmplGuestRsvpConfirmation,
          tmplEmailVerification: cfg.tmplEmailVerification,
          tmplPasswordReset: cfg.tmplPasswordReset,
        });
      },
      // Without this a failed request left `config()` null forever, and the
      // template's else-branch is a spinner -- so the screen span indefinitely
      // with nothing said. The same symptom the API's null response caused.
      error: () => {
        this.snackBar.open('Could not load email settings', 'OK', { duration: 6000 });
      },
    });
  }

  /**
   * Fetches one page of the log with the current filters applied.
   *
   * **Dates are sent as full ISO instants**, converted from the picker's local
   * midnight, rather than as `YYYY-MM-DD`. The API accepts both, but a bare date
   * is interpreted in UTC there — sending instants means the range a viewer
   * selects is the range in their own day, which is what they meant, and keeps
   * the server from having to guess a timezone.
   */
  loadLog(): void {
    this.loading.set(true);

    let params = new HttpParams()
      .set('page', String(this.page()))
      .set('limit', String(this.pageSize()));
    const q = this.search().trim();
    if (q) params = params.set('q', q);
    if (this.statusFilter()) params = params.set('status', this.statusFilter());
    const from = this.fromDate();
    if (from) params = params.set('from', startOfLocalDay(from).toISOString());
    const to = this.toDate();
    if (to) params = params.set('to', endOfLocalDay(to).toISOString());

    this.http.get<EmailLogPage>('/api/v1/admin/email/log', { params }).subscribe({
      next: (res) => {
        this.queue.set(res.rows);
        this.total.set(res.total);
        this.pages.set(res.pages);
        this.counts.set(res.counts);
        // Clamp, so deleting the last row of the last page does not strand the
        // viewer on an empty page past the end with no way back but the filters.
        if (res.page > res.pages) {
          this.page.set(res.pages);
          this.loadLog();
          return;
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Typing re-queries after a pause, and always from page one. */
  onSearchInput(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page.set(1);
      this.loadLog();
    }, 300);
  }

  /** Any filter change resets to page one — page 4 of a new filter is nonsense. */
  applyFilters(): void {
    this.page.set(1);
    this.loadLog();
  }

  clearFilters(): void {
    this.search.set('');
    this.statusFilter.set('');
    this.fromDate.set(null);
    this.toDate.set(null);
    this.page.set(1);
    this.loadLog();
  }

  goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.pages());
    if (target === this.page()) return;
    this.page.set(target);
    this.expandedRowId.set(null);
    this.loadLog();
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.loadLog();
  }

  /** The 1-based range this page covers, for "showing 51–100 of 1,284". */
  readonly rangeStart = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  readonly rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  /** Clears a stored key, so the provider falls back to its env var. */
  removeKey(provider: 'brevo' | 'resend'): void {
    if (!confirm(`Remove the stored ${provider === 'brevo' ? 'Brevo' : 'Resend'} API key?`)) return;
    this.saving.set(true);
    const patch: EmailConfigPatch =
      provider === 'brevo' ? { brevoApiKey: null } : { resendApiKey: null };
    this.http.patch<EmailConfig>('/api/v1/admin/email/config', patch).subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        this.saving.set(false);
        this.snackBar.open('Stored key removed', 'OK', { duration: 2000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to remove key', 'OK', { duration: 3000 });
      },
    });
  }

  patchConfig(patch: EmailConfigPatch): void {
    this.http.patch<EmailConfig>('/api/v1/admin/email/config', patch).subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        this.snackBar.open('Saved', 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Failed to save', 'OK', { duration: 3000 }),
    });
  }

  saveBrevo(): void {
    this.saving.set(true);
    const val = this.brevoForm.getRawValue();
    // Omitted, not null, when blank. The API treats an absent key as "leave it
    // alone" and an explicit null as "clear it", and blank here means the admin
    // did not retype a key they cannot see.
    const patch: EmailConfigPatch = {
      brevoFromEmail: val.brevoFromEmail || null,
      brevoFromName: val.brevoFromName || null,
    };
    if (val.brevoApiKey) patch.brevoApiKey = val.brevoApiKey;
    this.http.patch<EmailConfig>('/api/v1/admin/email/config', patch).subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        this.saving.set(false);
        this.snackBar.open('Brevo credentials saved', 'OK', { duration: 2000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
      },
    });
  }

  saveResend(): void {
    this.saving.set(true);
    const val = this.resendForm.getRawValue();
    const patch: EmailConfigPatch = {
      resendFromEmail: val.resendFromEmail || null,
      resendFromName: val.resendFromName || null,
    };
    if (val.resendApiKey) patch.resendApiKey = val.resendApiKey;
    this.http.patch<EmailConfig>('/api/v1/admin/email/config', patch).subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        this.saving.set(false);
        this.snackBar.open('Resend credentials saved', 'OK', { duration: 2000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
      },
    });
  }

  saveTemplates(): void {
    this.saving.set(true);
    const val = this.templatesForm.getRawValue();
    this.http.patch<EmailConfig>('/api/v1/admin/email/config', val).subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        this.saving.set(false);
        this.snackBar.open('Template IDs saved', 'OK', { duration: 2000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
      },
    });
  }

  flushQueue(): void {
    this.flushing.set(true);
    this.http.post('/api/v1/admin/email/flush', {}).subscribe({
      next: () => {
        this.snackBar.open('Queue flushed', 'OK', { duration: 2000 });
        this.flushing.set(false);
        this.loadLog();
        // The counters and the account allowance both moved, or the button was
        // pressed precisely to find out that they had not. Either way the
        // numbers on screen are the point of pressing it.
        this.loadConfig();
        this.loadQuotaWindow();
      },
      error: () => {
        this.snackBar.open('Flush failed', 'OK', { duration: 3000 });
        this.flushing.set(false);
      },
    });
  }

  retryFailed(): void {
    this.retrying.set(true);
    this.http.post<{ retried: number }>('/api/v1/admin/email/retry-failed', {}).subscribe({
      next: (res) => {
        this.snackBar.open(`${res.retried} email(s) queued for retry`, 'OK', { duration: 3000 });
        this.retrying.set(false);
        this.loadLog();
      },
      error: () => {
        this.snackBar.open('Retry failed', 'OK', { duration: 3000 });
        this.retrying.set(false);
      },
    });
  }

  /**
   * Expands a row and fetches its stored content.
   *
   * The body is not in the list response, so it is fetched here — once per
   * expand, which is the trade that keeps the list small. A failure leaves the
   * row expanded with no content rather than closing it again: the envelope
   * fields above are the useful part and are already on screen.
   */
  toggleDetail(id: number): void {
    if (this.expandedRowId() === id) {
      this.expandedRowId.set(null);
      this.expandedContent.set(null);
      return;
    }

    this.expandedRowId.set(id);
    this.expandedContent.set(null);
    this.loadingContent.set(true);
    this.http.get<EmailLogContent>(`/api/v1/admin/email/log/${id}`).subscribe({
      next: (content) => {
        // Guard against a slow response for a row the admin has since collapsed
        // or navigated away from, which would otherwise show one message's body
        // under another's heading.
        if (this.expandedRowId() === id) this.expandedContent.set(content);
        this.loadingContent.set(false);
      },
      error: () => this.loadingContent.set(false),
    });
  }

  cancelEmail(id: number): void {
    this.http.delete(`/api/v1/admin/email/${id}`).subscribe({
      next: () => {
        this.snackBar.open('Email cancelled', 'OK', { duration: 2000 });
        this.loadLog();
      },
      error: () => this.snackBar.open('Failed to cancel', 'OK', { duration: 3000 }),
    });
  }
}
