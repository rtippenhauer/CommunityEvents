import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RestaurantsService, ImportResult, ImportDetail } from '../../../core/services/restaurants.service';

interface City {
  id: number;
  name: string;
}

type DialogStep = 'form' | 'importing' | 'done';

@Component({
  selector: 'app-facebook-import-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>Import Restaurants from Facebook</h2>

    <mat-dialog-content class="import-content">

      @if (step() === 'form') {
        <p class="instructions">
          Export your Facebook Group's event data, then upload the events JSON file below.
          Restaurants already in the database are skipped automatically.
        </p>

        <ol class="steps">
          <li>Open your Facebook Group and click <strong>Manage</strong></li>
          <li>Go to <strong>Group Settings → Export Group Data</strong></li>
          <li>Download the ZIP, extract it, and find <strong>events.json</strong></li>
          <li>Select that file and the city below, then click Import</li>
        </ol>

        <mat-form-field appearance="outline" class="city-select">
          <mat-label>City for this group</mat-label>
          <mat-select [formControl]="cityCtrl">
            @for (city of cities(); track city.id) {
              <mat-option [value]="city.id">{{ city.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <!-- File drop zone -->
        <div
          class="drop-zone"
          [class.drag-over]="isDragOver()"
          [class.has-file]="selectedFile()"
          (dragover)="onDragOver($event)"
          (dragleave)="isDragOver.set(false)"
          (drop)="onDrop($event)"
          (click)="fileInput.click()"
          role="button"
          tabindex="0"
          (keydown.enter)="fileInput.click()"
          aria-label="Upload JSON file"
        >
          <input
            #fileInput
            type="file"
            accept=".json"
            style="display:none"
            (change)="onFileChange($event)"
          />

          @if (selectedFile()) {
            <mat-icon class="drop-icon done">check_circle</mat-icon>
            <p class="drop-label">{{ selectedFile()!.name }}</p>
            <p class="drop-hint">Click to change file</p>
          } @else {
            <mat-icon class="drop-icon">upload_file</mat-icon>
            <p class="drop-label">Drop events.json here</p>
            <p class="drop-hint">or click to browse</p>
          }
        </div>

        @if (errorMsg()) {
          <p class="error-msg">{{ errorMsg() }}</p>
        }
      }

      @if (step() === 'importing') {
        <div class="spinner-wrap">
          <mat-spinner diameter="48" />
          <p>Importing restaurants and geocoding addresses…</p>
          <p class="hint">This may take a moment if geocoding is enabled.</p>
        </div>
      }

      @if (step() === 'done' && result()) {
        <!-- Summary chips -->
        <div class="summary">
          <div class="chip inserted">
            <mat-icon>check_circle</mat-icon>
            <span>{{ result()!.inserted }} inserted</span>
          </div>
          <div class="chip skipped">
            <mat-icon>remove_circle</mat-icon>
            <span>{{ result()!.skipped }} skipped</span>
          </div>
          @if (result()!.errors > 0) {
            <div class="chip error">
              <mat-icon>error</mat-icon>
              <span>{{ result()!.errors }} errors</span>
            </div>
          }
        </div>

        <!-- Detail list -->
        @if (result()!.details.length > 0) {
          <div class="detail-list">
            @for (d of result()!.details; track d.name) {
              <div class="detail-row" [class]="d.status">
                <mat-icon class="row-icon">{{ statusIcon(d) }}</mat-icon>
                <span class="row-name">{{ d.name }}</span>
                @if (d.reason) {
                  <span class="row-reason">— {{ d.reason }}</span>
                }
              </div>
            }
          </div>
        }
      }

    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (step() === 'form') {
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          mat-raised-button
          color="primary"
          (click)="startImport()"
          [disabled]="!selectedFile() || !cityCtrl.value"
        >
          Import
        </button>
      }
      @if (step() === 'done') {
        <button mat-raised-button color="primary" (click)="close()">Done</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .import-content {
      min-width: min(90vw, 540px);
      padding-top: 4px;
    }

    .instructions {
      margin: 0 0 12px;
      color: #555;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .steps {
      margin: 0 0 20px;
      padding-left: 20px;
      font-size: 0.875rem;
      color: #444;
      line-height: 1.8;
    }

    .city-select {
      width: 100%;
      margin-bottom: 16px;
    }

    /* Drop zone */
    .drop-zone {
      border: 2px dashed #ccc;
      border-radius: 12px;
      padding: 32px 24px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      background: var(--db-cream);

      &:hover, &.drag-over {
        border-color: var(--db-primary);
        background: var(--db-cream-dark);
      }

      &.has-file {
        border-color: #4caf50;
        background: #f1f8f1;
      }
    }

    .drop-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #aaa;
      margin-bottom: 8px;

      &.done {
        color: #4caf50;
      }
    }

    .drop-label {
      margin: 0 0 4px;
      font-weight: 500;
      color: var(--db-brown-dark);
      font-size: 0.95rem;
      word-break: break-all;
    }

    .drop-hint {
      margin: 0;
      font-size: 0.8rem;
      color: #999;
    }

    .error-msg {
      margin: 12px 0 0;
      color: #c62828;
      font-size: 0.875rem;
    }

    /* Spinner */
    .spinner-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 0;
      gap: 16px;

      p {
        margin: 0;
        color: #555;
        text-align: center;
      }

      .hint {
        font-size: 0.8rem;
        color: #999;
      }
    }

    /* Summary chips */
    .summary {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: 500;
      font-size: 0.9rem;

      &.inserted { background: #e8f5e9; color: #2e7d32; mat-icon { color: #2e7d32; } }
      &.skipped  { background: #f5f5f5; color: #616161; mat-icon { color: #9e9e9e; } }
      &.error    { background: #ffebee; color: #c62828; mat-icon { color: #c62828; } }
    }

    /* Detail list */
    .detail-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 4px 0;
    }

    .detail-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      font-size: 0.875rem;

      &:not(:last-child) {
        border-bottom: 1px solid #f5f5f5;
      }

      &.inserted { .row-icon { color: #4caf50; } }
      &.skipped  { .row-icon { color: #9e9e9e; } }
      &.error    { .row-icon { color: #c62828; } }
    }

    .row-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .row-name {
      font-weight: 500;
      color: var(--db-brown-dark);
    }

    .row-reason {
      color: #888;
      font-size: 0.8rem;
    }
  `],
})
export class FacebookImportDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<FacebookImportDialogComponent>);
  private readonly http = inject(HttpClient);
  private readonly restaurantsService = inject(RestaurantsService);

  readonly step = signal<DialogStep>('form');
  readonly cities = signal<City[]>([]);
  readonly selectedFile = signal<File | null>(null);
  readonly isDragOver = signal(false);
  readonly result = signal<ImportResult | null>(null);
  readonly errorMsg = signal<string | null>(null);

  readonly cityCtrl = new FormControl<number | null>(null);

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((c) => this.cities.set(c));
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.setFile(file);
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.setFile(file);
    input.value = '';
  }

  private setFile(file: File): void {
    if (!file.name.toLowerCase().endsWith('.json')) {
      this.errorMsg.set('Please select a .json file');
      return;
    }
    this.errorMsg.set(null);
    this.selectedFile.set(file);
  }

  startImport(): void {
    const file = this.selectedFile();
    const cityId = this.cityCtrl.value;
    if (!file || !cityId) return;

    this.step.set('importing');

    this.restaurantsService.importFacebook(file, cityId).subscribe({
      next: (res) => {
        this.result.set(res);
        this.step.set('done');
      },
      error: (err: { error?: { message?: string } }) => {
        this.errorMsg.set(err?.error?.message ?? 'Import failed — check the file and try again');
        this.step.set('form');
      },
    });
  }

  statusIcon(d: ImportDetail): string {
    if (d.status === 'inserted') return 'check_circle';
    if (d.status === 'error') return 'error';
    return 'remove_circle';
  }

  close(): void {
    this.dialogRef.close((this.result()?.inserted ?? 0) > 0);
  }
}
