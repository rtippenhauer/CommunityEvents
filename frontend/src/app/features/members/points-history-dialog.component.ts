import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommunityService, PointLedgerEntry } from '../../core/services/community.service';
import { BrandConfigService } from '../../core/services/brand-config.service';

export interface PointsHistoryDialogData {
  memberId: number;
}

@Component({
  selector: 'app-points-history-dialog',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title><mat-icon>pets</mat-icon> {{ brand.points() }} History</h2>
    <mat-dialog-content>
      @if (loading()) {
        <div class="ph-loading"><mat-spinner diameter="24" /></div>
      } @else if (entries().length === 0) {
        <p class="ph-empty">No points earned yet.</p>
      } @else {
        <div class="ph-list">
          @for (entry of entries(); track entry.date + entry.achievement) {
            <div class="ph-row">
              <span class="ph-date">{{ entry.date | date: 'MMM d, y' }}</span>
              <span class="ph-achievement">{{ entry.achievement }}</span>
              <span class="ph-points">+{{ entry.points }}</span>
            </div>
          }
        </div>
        <div class="ph-total-row">
          <span>Total</span>
          <span>{{ total() }}</span>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      mat-dialog-content {
        min-width: 320px;
        max-width: 480px;
      }
      .ph-loading {
        display: flex;
        justify-content: center;
        padding: 16px;
      }
      .ph-empty {
        color: #999;
        font-size: 0.9rem;
        margin: 0;
      }
      .ph-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ph-row {
        display: grid;
        grid-template-columns: 90px 1fr auto;
        gap: 10px;
        align-items: center;
        padding: 6px 4px;
        border-bottom: 1px solid #f0ebe3;
        font-size: 0.9rem;
      }
      .ph-date {
        color: #777;
        white-space: nowrap;
      }
      .ph-achievement {
        color: var(--db-brown-dark);
      }
      .ph-points {
        font-weight: 600;
        color: #2e7d32;
        white-space: nowrap;
      }
      .ph-total-row {
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 2px solid #e8e0d6;
        font-weight: 700;
        font-size: 0.95rem;
      }
    `,
  ],
})
export class PointsHistoryDialogComponent {
  private readonly communityService = inject(CommunityService);
  readonly brand = inject(BrandConfigService);
  readonly data = inject<PointsHistoryDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly entries = signal<PointLedgerEntry[]>([]);
  readonly total = signal(0);

  constructor() {
    this.communityService.getPointsHistory(this.data.memberId).subscribe({
      next: (ledger) => {
        this.entries.set(ledger.entries);
        this.total.set(ledger.total);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
