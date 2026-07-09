import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-enrich-diagnose-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Enrichment Diagnosis — {{ data.restaurant?.name }}</h2>

    <mat-dialog-content class="diagnose-content">

      <!-- API Keys -->
      <section>
        <h3>API Keys</h3>
        <div class="row">
          <span class="icon" [class.ok]="data.keys.googlePlaces" [class.err]="!data.keys.googlePlaces">
            {{ data.keys.googlePlaces ? '✓' : '✗' }}
          </span>
          GOOGLE_PLACES_API_KEY {{ data.keys.googlePlaces ? 'configured' : 'NOT configured' }}
        </div>
        <div class="row">
          <span class="icon" [class.ok]="data.keys.anthropic" [class.err]="!data.keys.anthropic">
            {{ data.keys.anthropic ? '✓' : '✗' }}
          </span>
          ANTHROPIC_API_KEY {{ data.keys.anthropic ? 'configured' : 'NOT configured' }}
        </div>
      </section>

      <!-- Restaurant state -->
      <section>
        <h3>Current Restaurant Data</h3>
        <div class="row"><b>Name:</b>&nbsp;{{ data.restaurant.name }}</div>
        <div class="row"><b>Address:</b>&nbsp;{{ data.restaurant.address }}</div>
        <div class="row">
          <span class="icon" [class.ok]="data.restaurant.hasDescription" [class.warn]="!data.restaurant.hasDescription">
            {{ data.restaurant.hasDescription ? '✓' : '○' }}
          </span>
          Description {{ data.restaurant.hasDescription ? 'exists' : 'missing' }}
        </div>
        <div class="row">
          <span class="icon" [class.ok]="data.restaurant.hasPhone" [class.warn]="!data.restaurant.hasPhone">
            {{ data.restaurant.hasPhone ? '✓' : '○' }}
          </span>
          Phone {{ data.restaurant.hasPhone ? 'exists' : 'missing' }}
        </div>
        <div class="row">
          <span class="icon" [class.ok]="data.restaurant.hasWebsite" [class.warn]="!data.restaurant.hasWebsite">
            {{ data.restaurant.hasWebsite ? '✓' : '○' }}
          </span>
          Website {{ data.restaurant.hasWebsite ? 'exists' : 'missing' }}
        </div>
        <div class="row">
          <span class="icon" [class.ok]="data.restaurant.photoCount > 0" [class.warn]="data.restaurant.photoCount === 0">
            {{ data.restaurant.photoCount > 0 ? '✓' : '○' }}
          </span>
          Photos: {{ data.restaurant.photoCount }}
        </div>
      </section>

      <!-- Google Places -->
      <section>
        <h3>Google Places API</h3>
        @if (!data.keys.googlePlaces) {
          <p class="muted">Skipped — no API key</p>
        } @else if (!data.places) {
          <p class="muted">No result returned</p>
        } @else {
          <div class="row"><b>Query:</b>&nbsp;<code>{{ data.places.query }}</code></div>
          <div class="row">
            <span class="icon" [class.ok]="data.places.searchStatus === 'OK'" [class.err]="data.places.searchStatus !== 'OK'">
              {{ data.places.searchStatus === 'OK' ? '✓' : '✗' }}
            </span>
            Search status: <b>{{ data.places.searchStatus }}</b>
          </div>
          @if (data.places.placeId) {
            <div class="row"><b>Place ID:</b>&nbsp;<code>{{ data.places.placeId }}</code></div>
            <div class="row"><b>Details status:</b>&nbsp;{{ data.places.detailsStatus }}</div>
            <div class="row"><b>Editorial summary:</b>&nbsp;{{ data.places.editorialSummary ?? '(none)' }}</div>
            <div class="row"><b>Phone:</b>&nbsp;{{ data.places.phone ?? '(none)' }}</div>
            <div class="row"><b>Website:</b>&nbsp;{{ data.places.website ?? '(none)' }}</div>
            <div class="row"><b>Address:</b>&nbsp;{{ data.places.formattedAddress ?? '(none)' }}</div>
            <div class="row"><b>Photos available:</b>&nbsp;{{ data.places.photoCount }}</div>
          }
        }
      </section>

      <!-- Claude -->
      <section>
        <h3>Claude (Anthropic)</h3>
        <div class="row">
          <span class="icon"
            [class.ok]="data.claude.status === 'ok'"
            [class.warn]="data.claude.status === 'skipped'"
            [class.err]="data.claude.status === 'error'">
            {{ data.claude.status === 'ok' ? '✓' : data.claude.status === 'skipped' ? '○' : '✗' }}
          </span>
          Status: <b>{{ data.claude.status }}</b> — {{ data.claude.reason }}
        </div>
        @if (data.claude.generatedDescription) {
          <div class="generated-desc">
            <b>Generated description:</b>
            <p>{{ data.claude.generatedDescription }}</p>
          </div>
        }
      </section>

      <!-- Will update / skip -->
      <section>
        <h3>Summary</h3>
        @if (data.willUpdate.length > 0) {
          <p class="update-header">Would update:</p>
          @for (item of data.willUpdate; track item) {
            <div class="row"><span class="icon ok">✓</span> {{ item }}</div>
          }
        }
        @if (data.willSkip.length > 0) {
          <p class="skip-header">Would skip:</p>
          @for (item of data.willSkip; track item) {
            <div class="row"><span class="icon warn">○</span> {{ item }}</div>
          }
        }
        @if (data.willUpdate.length === 0 && data.willSkip.length === 0) {
          <p class="muted">No fields evaluated.</p>
        }
      </section>

    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-raised-button color="primary" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .diagnose-content {
      min-width: min(90vw, 620px);
      max-height: 70vh;
      overflow-y: auto;
      font-size: 0.9rem;
    }
    section {
      margin-bottom: 20px;
      h3 {
        font-size: 0.85rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--db-primary, #1E4D8C);
        margin: 0 0 8px;
        border-bottom: 1px solid #eee;
        padding-bottom: 4px;
      }
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 4px;
      line-height: 1.5;
      flex-wrap: wrap;
    }
    .icon {
      font-style: normal;
      font-weight: 700;
      flex-shrink: 0;
      &.ok   { color: #2e7d32; }
      &.warn { color: #e65100; }
      &.err  { color: #c62828; }
    }
    code {
      background: #f5f5f5;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 0.82rem;
      word-break: break-all;
    }
    .muted { color: #999; font-style: italic; margin: 0; }
    .generated-desc {
      margin-top: 8px;
      background: #f9fbe7;
      border-left: 3px solid #aed581;
      padding: 8px 12px;
      border-radius: 4px;
      p { margin: 4px 0 0; line-height: 1.5; }
    }
    .update-header { margin: 0 0 4px; font-weight: 600; color: #2e7d32; }
    .skip-header   { margin: 8px 0 4px; font-weight: 600; color: #888; }
  `],
})
export class EnrichDiagnoseDialogComponent {
  readonly data = inject(MAT_DIALOG_DATA);
}
