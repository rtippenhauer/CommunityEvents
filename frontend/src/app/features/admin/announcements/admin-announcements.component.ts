import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AnnouncementsService, Announcement } from '../../../core/services/announcements.service';
import { CityService } from '../../../core/services/city.service';

@Component({
  selector: 'app-admin-announcements',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="page-header">
      <h1>Announcements</h1>
      <button mat-raised-button color="primary" (click)="openNew()">
        <mat-icon>add</mat-icon> New Announcement
      </button>
    </div>

    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else {
      <!-- Composer / Editor Panel -->
      @if (showForm()) {
        <div class="form-panel">
          <h2 class="form-title">{{ editingId() ? 'Edit' : 'New' }} Announcement</h2>
          <form [formGroup]="form" (ngSubmit)="save()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Title</mat-label>
              <input matInput formControlName="title" maxlength="200" />
              <mat-error>Required</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Body</mat-label>
              <textarea matInput formControlName="body" rows="8" maxlength="10000"></textarea>
              <mat-hint align="end">{{ form.controls.body.value.length }}/10000</mat-hint>
              <mat-error>Required</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>City Scope</mat-label>
              <mat-select formControlName="cityId">
                <mat-option [value]="null">All Cities</mat-option>
                @for (city of cityService.cities(); track city.id) {
                  <mat-option [value]="city.id">{{ city.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <div class="form-actions">
              <button mat-button type="button" (click)="cancelForm()">Cancel</button>
              <button mat-raised-button type="submit" [disabled]="form.invalid || saving()">
                @if (saving()) {
                  <mat-spinner diameter="18" />
                } @else {
                  Save Draft
                }
              </button>
            </div>
          </form>
        </div>
      }

      <!-- List -->
      <div class="ann-table">
        @for (a of announcements(); track a.id) {
          <div class="ann-row" [class.draft]="a.status === 'draft'">
            <div class="ann-row-main">
              <div class="ann-row-status">
                <mat-chip [class]="'status-chip status-' + a.status">
                  {{ a.status }}
                </mat-chip>
                @if (a.city) {
                  <mat-chip class="city-chip">{{ a.city.name }}</mat-chip>
                }
              </div>
              <div class="ann-row-title">{{ a.title }}</div>
              <div class="ann-row-meta">
                {{
                  a.status === 'published'
                    ? (a.publishedAt | date: 'MMM d, y')
                    : (a.createdAt | date: 'MMM d, y')
                }}
              </div>
            </div>
            <div class="ann-row-actions">
              <button mat-icon-button matTooltip="Edit" (click)="startEdit(a)">
                <mat-icon>edit</mat-icon>
              </button>
              @if (a.status === 'draft') {
                <button mat-icon-button matTooltip="Publish" color="primary" (click)="publish(a)">
                  <mat-icon>publish</mat-icon>
                </button>
              }
              <button mat-icon-button matTooltip="Delete" color="warn" (click)="delete(a)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          </div>
        }
        @if (announcements().length === 0 && !showForm()) {
          <p class="empty">No announcements yet.</p>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        h1 {
          margin: 0;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .form-panel {
        background: #fff;
        border: 1px solid #e8e0d6;
        border-radius: 10px;
        padding: 24px;
        margin-bottom: 24px;
        max-width: 700px;
      }
      .form-title {
        margin: 0 0 16px;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .full-width {
        width: 100%;
      }
      .form-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 8px;
      }
      .ann-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 900px;
      }
      .ann-row {
        display: flex;
        align-items: center;
        background: #fff;
        border: 1px solid #e8e0d6;
        border-radius: 8px;
        padding: 12px 16px;
        gap: 12px;
        &.draft {
          border-left: 3px solid #f0a500;
        }
      }
      .ann-row-main {
        flex: 1;
        min-width: 0;
      }
      .ann-row-status {
        display: flex;
        gap: 6px;
        margin-bottom: 4px;
      }
      .status-chip {
        font-size: 0.68rem !important;
        height: 20px !important;
      }
      .status-published {
        --mat-chip-label-text-color: #2e7d32;
        --mat-chip-container-color: #e8f5e9;
      }
      .status-draft {
        --mat-chip-label-text-color: #e65100;
        --mat-chip-container-color: #fff3e0;
      }
      .city-chip {
        font-size: 0.68rem !important;
        height: 20px !important;
      }
      .ann-row-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--db-brown-dark);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ann-row-meta {
        font-size: 0.72rem;
        color: #aaa;
        margin-top: 2px;
      }
      .ann-row-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }
      .empty {
        color: #999;
        text-align: center;
        padding: 32px 0;
      }
    `,
  ],
})
export class AdminAnnouncementsComponent implements OnInit {
  private readonly announcementsService = inject(AnnouncementsService);
  readonly cityService = inject(CityService);
  private readonly snackBar = inject(MatSnackBar);

  readonly announcements = signal<Announcement[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showForm = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(10000)],
    }),
    cityId: new FormControl<number | null>(null),
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.announcementsService.adminGetAll().subscribe({
      next: (list) => {
        this.announcements.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openNew(): void {
    this.editingId.set(null);
    this.form.reset({ title: '', body: '', cityId: null });
    this.showForm.set(true);
  }

  startEdit(a: Announcement): void {
    this.editingId.set(a.id);
    this.form.setValue({ title: a.title, body: a.body, cityId: a.cityId });
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const { title, body, cityId } = this.form.getRawValue();
    const id = this.editingId();
    const req = id
      ? this.announcementsService.adminUpdate(id, { title, body, cityId })
      : this.announcementsService.adminCreate({ title, body, cityId });

    req.subscribe({
      next: (saved) => {
        if (id) {
          this.announcements.update((list) => list.map((a) => (a.id === id ? saved : a)));
        } else {
          this.announcements.update((list) => [saved, ...list]);
        }
        this.saving.set(false);
        this.cancelForm();
        this.snackBar.open('Saved.', 'OK', { duration: 2500 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Save failed.', 'OK', { duration: 3000 });
      },
    });
  }

  publish(a: Announcement): void {
    this.announcementsService.adminPublish(a.id).subscribe({
      next: (updated) => {
        this.announcements.update((list) => list.map((x) => (x.id === a.id ? updated : x)));
        this.snackBar.open('Published!', 'OK', { duration: 2500 });
      },
      error: () => this.snackBar.open('Publish failed.', 'OK', { duration: 3000 }),
    });
  }

  delete(a: Announcement): void {
    if (!confirm(`Delete "${a.title}"?`)) return;
    this.announcementsService.adminDelete(a.id).subscribe({
      next: () => {
        this.announcements.update((list) => list.filter((x) => x.id !== a.id));
        this.snackBar.open('Deleted.', 'OK', { duration: 2500 });
      },
      error: () => this.snackBar.open('Delete failed.', 'OK', { duration: 3000 }),
    });
  }
}
