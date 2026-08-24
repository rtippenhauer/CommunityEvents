import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, JsonPipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
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

interface EmailQueueItem {
  id: number;
  toEmail: string;
  toName: string | null;
  subject: string | null;
  templateId: string | null;
  templateParams: Record<string, unknown> | null;
  htmlBody: string | null;
  textBody: string | null;
  status: string;
  provider: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  errorMessage: string | null;
  brevoStatus: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

/**
 * What a PATCH may send. Distinct from EmailConfig because the two API keys are
 * write-only: they go up, they never come back down.
 */
type EmailConfigPatch = Partial<Omit<EmailConfig, 'brevoApiKeySet' | 'resendApiKeySet'>> & {
  brevoApiKey?: string | null;
  resendApiKey?: string | null;
};

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
  // Deliverability callbacks. The token itself never reaches the browser --
  // it is minted server-side, handed to Brevo through their API and stored
  // encrypted, so the screen only ever learns whether one is registered.
  webhookRegistered: boolean;
  webhookRotatedAt: string | null;
  webhookError: string | null;
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
              <button mat-icon-button (click)="loadQueue()" matTooltip="Refresh queue">
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
                  <span>Sent today</span>
                  <strong>{{ cfg.brevoSentToday }} / {{ cfg.brevoDailyLimit }}</strong>
                </div>
                <div class="provider-stat">
                  <span>Reset date</span> <strong>{{ cfg.lastResetDate }}</strong>
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
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>API Key</mat-label>
                <input matInput formControlName="brevoApiKey" type="password" autocomplete="off" />
                <mat-hint>
                  @if (config()?.brevoApiKeySet) {
                    A key is stored — leave blank to keep it.
                  } @else {
                    Not set; falls back to the BREVO_API_KEY env var.
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

        <!-- Queue -->
        <mat-card>
          <mat-card-header>
            <mat-card-title>Email Queue</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            @if (loading()) {
              <mat-spinner diameter="28" />
            } @else if (queue().length === 0) {
              <p class="empty-state">Queue is empty.</p>
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
                        @if (row.templateParams) {
                          <div class="detail-block">
                            <span>Template params</span>
                            <pre>{{ row.templateParams | json }}</pre>
                          </div>
                        }
                        @if (row.htmlBody) {
                          <div class="detail-block">
                            <span>HTML body (source)</span>
                            <pre class="detail-body">{{ row.htmlBody }}</pre>
                          </div>
                        }
                        @if (row.textBody) {
                          <div class="detail-block">
                            <span>Text body</span>
                            <pre class="detail-body">{{ row.textBody }}</pre>
                          </div>
                        }
                        @if (!row.templateParams && !row.htmlBody && !row.textBody) {
                          <p class="empty-state">
                            No stored content for this email — it may have been sent via provider
                            template only.
                          </p>
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
            }
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-spinner diameter="40" />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
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

  readonly queue = signal<EmailQueueItem[]>([]);
  readonly config = signal<EmailConfig | null>(null);
  readonly loading = signal(false);
  readonly retrying = signal(false);
  readonly flushing = signal(false);
  readonly saving = signal(false);
  readonly registeringWebhook = signal(false);
  readonly failedCount = computed(() => this.queue().filter((e) => e.status === 'failed').length);
  readonly expandedRowId = signal<number | null>(null);

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
    this.loadQueue();
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
    });
  }

  loadQueue(): void {
    this.loading.set(true);
    this.http.get<EmailQueueItem[]>('/api/v1/admin/email/queue').subscribe({
      next: (q) => {
        this.queue.set(q);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

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
        this.loadQueue();
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
        this.loadQueue();
      },
      error: () => {
        this.snackBar.open('Retry failed', 'OK', { duration: 3000 });
        this.retrying.set(false);
      },
    });
  }

  toggleDetail(id: number): void {
    this.expandedRowId.set(this.expandedRowId() === id ? null : id);
  }

  cancelEmail(id: number): void {
    this.http.delete(`/api/v1/admin/email/${id}`).subscribe({
      next: () => {
        this.snackBar.open('Email cancelled', 'OK', { duration: 2000 });
        this.loadQueue();
      },
      error: () => this.snackBar.open('Failed to cancel', 'OK', { duration: 3000 }),
    });
  }
}
