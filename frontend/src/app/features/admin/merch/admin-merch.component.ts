import { Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MerchService } from '../../../core/services/merch.service';

@Component({
  selector: 'app-admin-merch',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="merch-admin-container">
      <h2 class="page-title">Merch Store</h2>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else {
        <mat-card>
          <mat-card-header>
            <mat-card-title>Store Links</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="form" (ngSubmit)="save()">
              <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
                <mat-label>Main Store URL</mat-label>
                <input matInput formControlName="storeUrl" placeholder="https://dinnerbears.printful.me/" />
                <mat-hint>
                  Shown to every member on the Merch page. Leave blank to close the
                  store — members will see a "store is closed" message instead of a
                  buy link.
                </mat-hint>
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
                <mat-label>Founding Bear Exclusive Product URL</mat-label>
                <input matInput formControlName="foundingBearProductUrl" placeholder="https://dinnerbears.printful.me/product/..." />
                <mat-hint>
                  Only shown to members with the Founding Bear achievement. Use an
                  unlisted/unpublished Printful product link — leave blank until
                  that product exists.
                </mat-hint>
              </mat-form-field>

              <button mat-raised-button color="primary" type="submit" [disabled]="saving()">
                <mat-icon>save</mat-icon> {{ saving() ? 'Saving…' : 'Save' }}
              </button>
            </form>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .merch-admin-container {
        max-width: 640px;
        margin: 0 auto;
        padding: 16px;
      }
      .page-title {
        margin: 0 0 20px;
        color: var(--db-brown-dark);
      }
      .full-width {
        width: 100%;
        margin-bottom: 12px;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
    `,
  ],
})
export class AdminMerchComponent implements OnInit {
  private readonly merchService = inject(MerchService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    storeUrl: this.fb.control<string | null>(null),
    foundingBearProductUrl: this.fb.control<string | null>(null),
  });

  ngOnInit(): void {
    this.merchService.getConfig().subscribe({
      next: (config) => {
        this.form.patchValue({
          storeUrl: config.storeUrl,
          foundingBearProductUrl: config.foundingBearProductUrl,
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  save(): void {
    this.saving.set(true);
    const value = this.form.getRawValue();
    this.merchService
      .updateConfig({
        storeUrl: value.storeUrl?.trim() || null,
        foundingBearProductUrl: value.foundingBearProductUrl?.trim() || null,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.snackBar.open('Merch settings saved', 'OK', { duration: 3000 });
        },
        error: () => {
          this.saving.set(false);
          this.snackBar.open('Failed to save merch settings', 'OK', { duration: 3000 });
        },
      });
  }
}
