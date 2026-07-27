import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommunityService, Achievement } from '../../../core/services/community.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';

interface LedgerRow {
  id: number;
  pointType: string;
  points: number;
  referenceId: number | null;
  awardedAt: string;
}

// new_location_coordinator's label is built at runtime from the configured
// venue term (see typeLabel) so it stays consistent for renamed instances.
const TYPE_LABELS: Record<string, string> = {
  attendance: 'Attendance',
  coordinator: 'Coordinator',
  invite: 'Invite',
  rating: 'Rating',
};

@Component({
  selector: 'app-admin-community',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="container">
      <div class="back-row">
        <a mat-button routerLink="/admin/users"> <mat-icon>arrow_back</mat-icon> Back to Users </a>
        <h2>Member #{{ memberId() }} — Points & Achievements</h2>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40" /></div>
      } @else {
        <!-- Points ledger -->
        <mat-card>
          <mat-card-header>
            <mat-card-title>{{ brand.points() }} Ledger (Total: {{ totalPoints() }})</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            @if (ledger().length === 0) {
              <p class="empty">No points awarded yet.</p>
            } @else {
              <table mat-table [dataSource]="ledger()" class="ledger-table">
                <ng-container matColumnDef="id">
                  <th mat-header-cell *matHeaderCellDef>#</th>
                  <td mat-cell *matCellDef="let row">{{ row.id }}</td>
                </ng-container>
                <ng-container matColumnDef="type">
                  <th mat-header-cell *matHeaderCellDef>Type</th>
                  <td mat-cell *matCellDef="let row">{{ typeLabel(row.pointType) }}</td>
                </ng-container>
                <ng-container matColumnDef="points">
                  <th mat-header-cell *matHeaderCellDef>Pts</th>
                  <td mat-cell *matCellDef="let row">{{ row.points }}</td>
                </ng-container>
                <ng-container matColumnDef="ref">
                  <th mat-header-cell *matHeaderCellDef>Reference</th>
                  <td mat-cell *matCellDef="let row">{{ referenceLabel(row) }}</td>
                </ng-container>
                <ng-container matColumnDef="date">
                  <th mat-header-cell *matHeaderCellDef>Awarded</th>
                  <td mat-cell *matCellDef="let row">{{ row.awardedAt | date: 'short' }}</td>
                </ng-container>
                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let row">
                    <button
                      mat-icon-button
                      color="warn"
                      (click)="removePoint(row.id)"
                      matTooltip="Remove this point award"
                    >
                      <mat-icon>delete</mat-icon>
                    </button>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="ledgerCols"></tr>
                <tr mat-row *matRowDef="let row; columns: ledgerCols"></tr>
              </table>
            }
          </mat-card-content>
        </mat-card>

        <!-- Achievements -->
        <mat-card class="ach-card">
          <mat-card-header>
            <mat-card-title>Achievements</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            @if (earnedAchievements().length === 0) {
              <p class="empty">No achievements earned yet.</p>
            } @else {
              <div class="ach-list">
                @for (ea of earnedAchievements(); track ea.id) {
                  <div class="ach-row">
                    <span class="ach-name">{{ ea.name }}</span>
                    @if (ea.title) {
                      <span class="ach-title-badge">{{ ea.title }}</span>
                    }
                    <span class="ach-date">{{ ea.earnedAt | date: 'mediumDate' }}</span>
                    <button
                      mat-icon-button
                      color="warn"
                      (click)="revokeAchievement(ea.id, ea.name)"
                      matTooltip="Revoke achievement"
                    >
                      <mat-icon>remove_circle</mat-icon>
                    </button>
                  </div>
                }
              </div>
            }
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .back-row {
        display: flex;
        align-items: center;
        gap: 12px;
        h2 {
          margin: 0;
          font-size: 1.1rem;
        }
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty {
        color: #888;
        padding: 16px 0;
      }
      .ledger-table {
        width: 100%;
      }
      .ach-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 8px;
      }
      .ach-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid #f0f0f0;
      }
      .ach-name {
        font-weight: 600;
        flex: 1;
      }
      .ach-title-badge {
        font-size: 0.75rem;
        background: #eaf0fa;
        color: var(--db-primary);
        border-radius: 10px;
        padding: 2px 8px;
      }
      .ach-date {
        font-size: 0.8rem;
        color: #888;
      }
    `,
  ],
})
export class AdminCommunityComponent implements OnInit {
  private readonly communityService = inject(CommunityService);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  readonly brand = inject(BrandConfigService);

  readonly loading = signal(true);
  readonly ledger = signal<LedgerRow[]>([]);
  readonly earnedAchievements = signal<Achievement[]>([]);
  readonly memberId = signal(0);
  readonly ledgerCols = ['id', 'type', 'points', 'ref', 'date', 'actions'];

  readonly totalPoints = () => this.ledger().reduce((sum, r) => sum + r.points, 0);

  private readonly achievementNameById = () =>
    new Map(this.earnedAchievements().map((a) => [a.id, a.name]));

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.memberId.set(id);
    this.load(id);
  }

  load(id: number): void {
    this.loading.set(true);
    Promise.all([
      this.communityService.getAdminLedger(id).toPromise(),
      this.communityService.getMemberAchievements(id).toPromise(),
    ])
      .then(([ledger, ach]) => {
        this.ledger.set((ledger ?? []) as LedgerRow[]);
        this.earnedAchievements.set(((ach ?? []) as Achievement[]).filter((a) => a.earned));
        this.loading.set(false);
      })
      .catch(() => this.loading.set(false));
  }

  removePoint(pointId: number): void {
    this.communityService.adminRemovePoint(pointId).subscribe({
      next: () => {
        this.ledger.update((rows) => rows.filter((r) => r.id !== pointId));
        this.snackBar.open('Point removed', 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Failed to remove point', 'OK', { duration: 3000 }),
    });
  }

  revokeAchievement(memberAchievementId: number, name: string): void {
    const id = this.memberId();
    this.communityService.adminRevokeAchievement(id, memberAchievementId).subscribe({
      next: () => {
        this.earnedAchievements.update((rows) => rows.filter((r) => r.id !== memberAchievementId));
        this.snackBar.open(`"${name}" revoked`, 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Failed to revoke achievement', 'OK', { duration: 3000 }),
    });
  }

  typeLabel(type: string): string {
    if (type === 'new_location_coordinator') {
      return `Coordinator (New ${this.brand.locationSingular()})`;
    }
    return TYPE_LABELS[type] ?? type;
  }

  referenceLabel(row: LedgerRow): string {
    if (row.referenceId == null) return '—';
    if (row.pointType === 'achievement') {
      return this.achievementNameById().get(row.referenceId) ?? `Achievement #${row.referenceId}`;
    }
    return String(row.referenceId);
  }
}
