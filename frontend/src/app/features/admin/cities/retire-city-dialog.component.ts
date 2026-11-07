import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  AdminCity,
  CitiesAdminService,
  CityRetirementImpact,
} from '../../../core/services/cities-admin.service';

export interface RetireCityDialogData {
  city: AdminCity;
  /** Other active cities, as destinations. */
  destinations: AdminCity[];
}

/**
 * Retiring a city.
 *
 * **Not a delete, and the dialog says so** — a city is never deleted (Rob,
 * 2026-10-18). The row stays, every foreign key pointing at it stays valid,
 * and past events keep it: a dinner that happened in Indiana happened in
 * Indiana, and a community that stops meeting there should not retroactively
 * have met somewhere else.
 *
 * Because it is not destructive it does **not** use the retype-the-name
 * confirmation that deleting a community does. What it owes the admin instead
 * is the counts: what is about to move, per table, derived server-side from
 * the schema rather than from a list anybody maintains by hand.
 */
@Component({
  selector: 'app-retire-city-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>Retire {{ data.city.name }}</h2>

    <mat-dialog-content>
      @if (loading()) {
        <div class="centered"><mat-spinner diameter="32" /></div>
      } @else if (impact(); as i) {
        <p class="lede">
          {{ data.city.name }} stops being offered anywhere. It is not deleted — past events keep
          it, so the history stays accurate.
        </p>

        @if (movingRows().length) {
          <ul class="impact">
            @for (row of movingRows(); track row.model) {
              <li>
                <strong>{{ row.count }}</strong> {{ row.label }}
                @switch (row.action) {
                  @case ('move') {
                    move to the city below
                  }
                  @case ('clear') {
                    lose their city
                  }
                  @case ('remove') {
                    are removed
                  }
                }
              </li>
            }
          </ul>
        } @else {
          <p class="impact-none">Nothing points at it — nothing moves.</p>
        }

        @if (i.requiresDestination) {
          @if (data.destinations.length) {
            <mat-form-field appearance="outline" class="dest">
              <mat-label>Move everything to</mat-label>
              <mat-select [formControl]="destination">
                @for (city of data.destinations; track city.id) {
                  <mat-option [value]="city.id">{{ city.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          } @else {
            <p class="warn">
              This is the only active city. Add another before retiring this one, or turn city
              filtering off.
            </p>
          }
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="warn" (click)="retire()" [disabled]="!canRetire()">
        @if (saving()) {
          <mat-spinner diameter="20" />
        } @else {
          Retire
        }
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      mat-dialog-content {
        min-width: 320px;
      }
      .centered {
        display: flex;
        justify-content: center;
        padding: 24px;
      }
      .lede {
        font-size: 0.9rem;
        line-height: 1.55;
        margin: 0 0 12px;
      }
      .impact {
        margin: 0 0 12px;
        padding-left: 20px;
        font-size: 0.88rem;
        line-height: 1.8;
      }
      .impact-none {
        font-size: 0.88rem;
        color: var(--ce-text-muted);
        margin: 0 0 12px;
      }
      .warn {
        font-size: 0.88rem;
        line-height: 1.5;
        /* The one place a literal white is correct: --ce-error-overlay is a
           75% opaque red built to sit over any community's surface, and there
           is no --ce-on-error token to pair with it. Same call
           admin-inbound-mail makes, for the same reason. */
        background: var(--ce-error-overlay);
        color: #fff;
        border-radius: 8px;
        padding: 10px 12px;
        margin: 0;
      }
      .dest {
        width: 100%;
      }
      @media (max-width: 480px) {
        mat-dialog-content {
          min-width: 0;
        }
      }
    `,
  ],
})
export class RetireCityDialogComponent implements OnInit {
  readonly data = inject<RetireCityDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RetireCityDialogComponent>);
  private readonly citiesAdminService = inject(CitiesAdminService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly impact = signal<CityRetirementImpact | null>(null);
  readonly destination = new FormControl<number | null>(null);

  ngOnInit(): void {
    this.citiesAdminService.retirementImpact(this.data.city.id).subscribe({
      next: (impact) => {
        this.impact.set(impact);
        this.destination.setValue(this.data.destinations[0]?.id ?? null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Only the tables that actually hold something, so nobody reads five zeroes. */
  movingRows(): CityRetirementImpact['rows'] {
    return this.impact()?.rows.filter((r) => r.count > 0) ?? [];
  }

  canRetire(): boolean {
    const i = this.impact();
    if (!i || this.saving()) return false;
    return !i.requiresDestination || this.destination.value !== null;
  }

  retire(): void {
    if (!this.canRetire()) return;
    this.saving.set(true);
    const dest = this.impact()?.requiresDestination ? (this.destination.value ?? undefined) : undefined;
    this.citiesAdminService.retire(this.data.city.id, dest).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.dialogRef.close(result);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const msg = err?.error?.message ?? 'Could not retire that city';
        this.snackBar.open(typeof msg === 'string' ? msg : JSON.stringify(msg), 'OK', {
          duration: 6000,
        });
      },
    });
  }
}
