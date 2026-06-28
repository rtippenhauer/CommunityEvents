import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-calendar-subscribe',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule],
  template: `
    <div class="cal-sub-row">
      @if (loading()) {
        <mat-spinner diameter="20" />
      } @else if (calendarUrl()) {
        <span class="cal-sub-label">Subscribe:</span>
        <a mat-stroked-button [href]="webcalUrl()" class="cal-sub-btn" matTooltip="Apple Calendar, Outlook, or any app that supports calendar subscriptions">
          <mat-icon>event</mat-icon>
          Apple / Outlook
        </a>
        <a mat-stroked-button [href]="googleCalUrl()" target="_blank" rel="noopener" class="cal-sub-btn">
          <mat-icon>open_in_new</mat-icon>
          Google Calendar
        </a>
        <button mat-icon-button (click)="copy()" matTooltip="Copy feed URL">
          <mat-icon>content_copy</mat-icon>
        </button>
      } @else {
        <button mat-stroked-button (click)="load()">
          <mat-icon>event</mat-icon>
          Subscribe to Calendar
        </button>
      }
    </div>
  `,
  styles: [`
    .cal-sub-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .cal-sub-label {
      font-size: 0.82rem;
      color: #888;
    }
    .cal-sub-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.82rem !important;
    }
  `],
})
export class CalendarSubscribeComponent {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(false);
  readonly calendarUrl = signal<string | null>(null);
  readonly webcalUrl = () => (this.calendarUrl() ?? '').replace(/^https?:\/\//, 'webcal://');
  readonly googleCalUrl = () => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(this.webcalUrl())}`;

  load(): void {
    this.loading.set(true);
    this.http.get<{ url: string }>('/api/v1/calendar/token').subscribe({
      next: (res) => { this.calendarUrl.set(res.url); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  copy(): void {
    const url = this.calendarUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.snackBar.open('Feed URL copied!', 'OK', { duration: 2500 });
    });
  }
}
