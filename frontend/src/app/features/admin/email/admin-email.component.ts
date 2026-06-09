import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
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
  template: string;
  status: string;
  provider: string | null;
  attempts: number;
  priority: number;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

interface EmailProviderConfig {
  id: number;
  brevoEnabled: boolean;
  brevoApiKey: string | null;
  brevoDailyLimit: number;
  brevoDailyCount: number;
  gmailEnabled: boolean;
  gmailDailyLimit: number;
  gmailDailyCount: number;
  lastResetAt: string;
}

@Component({
  selector: 'app-admin-email',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  template: `
    <div class="email-admin-container">
      <h2 class="page-title">Email Admin</h2>

      <!-- Provider config card -->
      <mat-card class="config-card">
        <mat-card-header>
          <mat-card-title>Provider Configuration</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (config(); as cfg) {
            <div class="provider-grid">
              <div class="provider-block">
                <div class="provider-header">
                  <span class="provider-name">Brevo</span>
                  <mat-slide-toggle
                    [checked]="cfg.brevoEnabled"
                    (change)="updateConfig({ brevoEnabled: $event.checked })"
                  />
                </div>
                <div class="provider-stat">
                  <span>Daily sent</span>
                  <strong>{{ cfg.brevoDailyCount }} / {{ cfg.brevoDailyLimit }}</strong>
                </div>
                <div class="provider-stat">
                  <span>Reset at</span>
                  <strong>{{ cfg.lastResetAt | date: 'short' }}</strong>
                </div>
              </div>

              <div class="provider-block">
                <div class="provider-header">
                  <span class="provider-name">Gmail (overflow)</span>
                  <mat-slide-toggle
                    [checked]="cfg.gmailEnabled"
                    (change)="updateConfig({ gmailEnabled: $event.checked })"
                  />
                </div>
                <div class="provider-stat">
                  <span>Daily sent</span>
                  <strong>{{ cfg.gmailDailyCount }} / {{ cfg.gmailDailyLimit }}</strong>
                </div>
              </div>
            </div>
          } @else {
            <mat-spinner diameter="28" />
          }
        </mat-card-content>
      </mat-card>

      <!-- Queue card -->
      <mat-card class="queue-card">
        <mat-card-header>
          <mat-card-title>Email Queue</mat-card-title>
          <div class="queue-actions">
            <button mat-stroked-button color="primary" (click)="retryFailed()" [disabled]="retrying()">
              <mat-icon>replay</mat-icon>
              Retry Failed
            </button>
            <button mat-icon-button (click)="loadQueue()" matTooltip="Refresh">
              <mat-icon>refresh</mat-icon>
            </button>
          </div>
        </mat-card-header>
        <mat-card-content>
          @if (loading()) {
            <mat-spinner diameter="28" />
          } @else if (queue().length === 0) {
            <p class="empty-state">Queue is empty.</p>
          } @else {
            <table mat-table [dataSource]="queue()" class="queue-table">
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let row">
                  <mat-chip [class]="'chip-' + row.status">{{ row.status }}</mat-chip>
                </td>
              </ng-container>

              <ng-container matColumnDef="template">
                <th mat-header-cell *matHeaderCellDef>Template</th>
                <td mat-cell *matCellDef="let row">{{ row.template }}</td>
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

              <ng-container matColumnDef="scheduledAt">
                <th mat-header-cell *matHeaderCellDef>Scheduled</th>
                <td mat-cell *matCellDef="let row">{{ row.scheduledAt | date: 'short' }}</td>
              </ng-container>

              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let row">
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

              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
            </table>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
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
      .config-card mat-card-content {
        padding-top: 8px;
      }
      .provider-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      @media (max-width: 600px) {
        .provider-grid { grid-template-columns: 1fr; }
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
      .queue-card mat-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
      .queue-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .queue-table {
        width: 100%;
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
      .chip-pending { background: #fff9c4 !important; }
      .chip-sent { background: #c8e6c9 !important; }
      .chip-failed { background: #ffccbc !important; }
      .chip-cancelled { background: #e0e0e0 !important; }
    `,
  ],
})
export class AdminEmailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  readonly queue = signal<EmailQueueItem[]>([]);
  readonly config = signal<EmailProviderConfig | null>(null);
  readonly loading = signal(false);
  readonly retrying = signal(false);

  readonly displayedColumns = ['status', 'template', 'toEmail', 'provider', 'attempts', 'scheduledAt', 'actions'];

  ngOnInit(): void {
    this.loadConfig();
    this.loadQueue();
  }

  loadConfig(): void {
    this.http.get<EmailProviderConfig>('/api/v1/admin/email/config').subscribe({
      next: (cfg) => this.config.set(cfg),
    });
  }

  loadQueue(): void {
    this.loading.set(true);
    this.http.get<EmailQueueItem[]>('/api/v1/admin/email/queue').subscribe({
      next: (q) => { this.queue.set(q); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  updateConfig(patch: Partial<EmailProviderConfig>): void {
    this.http.patch<EmailProviderConfig>('/api/v1/admin/email/config', patch).subscribe({
      next: (cfg) => {
        this.config.set(cfg);
        this.snackBar.open('Config updated', 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Failed to update config', 'OK', { duration: 3000 }),
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
      error: () => { this.snackBar.open('Retry failed', 'OK', { duration: 3000 }); this.retrying.set(false); },
    });
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
