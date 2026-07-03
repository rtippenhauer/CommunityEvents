import { Component, OnInit, signal, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CalendarService, CalendarSettings } from '../../core/services/calendar.service';

@Component({
  selector: 'app-profile-calendar',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="cal-page">
      <h1 class="page-title">Calendar Subscription</h1>
      <p class="page-subtitle">
        Subscribe to your personal DinnerBears feed so upcoming dinners appear automatically
        in Apple Calendar, Google Calendar, Outlook, or any iCal-compatible app.
      </p>

      @if (loading()) {
        <div class="loading-center"><mat-spinner diameter="36" /></div>
      } @else if (settings()) {

        <!-- Feed URL card -->
        <mat-card class="cal-card">
          <mat-card-header>
            <mat-card-title>Your Feed URL</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="url-row">
              <input class="url-input" [value]="settings()!.url" readonly aria-label="Calendar feed URL" />
              <button mat-icon-button (click)="copy()" matTooltip="Copy URL">
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
            <div class="subscribe-row">
              <a mat-stroked-button [href]="webcalUrl()" matTooltip="Apple Calendar, Outlook, or any iCal-compatible app">
                <mat-icon>calendar_today</mat-icon> Apple / Outlook
              </a>
              <a mat-stroked-button [href]="googleUrl()" target="_blank" rel="noopener">
                <mat-icon>open_in_new</mat-icon> Google Calendar
              </a>
            </div>
            <mat-divider class="regen-divider" />
            <p class="regen-hint">
              If you need to revoke calendar access from a specific device or app, regenerate your token.
              Old subscription URLs will stop working immediately.
            </p>
            @if (!showRegenConfirm()) {
              <button mat-button (click)="showRegenConfirm.set(true)" [disabled]="regenerating()">
                <mat-icon>refresh</mat-icon> Regenerate Token
              </button>
            } @else {
              <div class="confirm-inline">
                <span class="confirm-text">Old subscription URLs will stop working. Are you sure?</span>
                <button mat-raised-button color="warn" (click)="regen()" [disabled]="regenerating()">
                  @if (regenerating()) { <mat-spinner diameter="16" /> }
                  @else { Yes, regenerate }
                </button>
                <button mat-button (click)="showRegenConfirm.set(false)">Cancel</button>
              </div>
            }
          </mat-card-content>
        </mat-card>

        <!-- Settings card -->
        <mat-card class="cal-card">
          <mat-card-header>
            <mat-card-title>Feed Settings</mat-card-title>
            <mat-card-subtitle>Changes save automatically</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>

            <div class="setting-group">
              <div class="setting-label">Cities to include</div>
              <mat-radio-group
                class="radio-group"
                [value]="settings()!.cityFilter"
                (change)="saveCityFilter($event.value)">
                <mat-radio-button value="all">
                  <span class="radio-title">All cities</span>
                  <span class="radio-desc">Show dinners from every DinnerBears chapter</span>
                </mat-radio-button>
                <mat-radio-button value="city">
                  <span class="radio-title">My city only</span>
                  <span class="radio-desc">Show only {{ settings()!.cityName }} dinners</span>
                </mat-radio-button>
              </mat-radio-group>
            </div>

            <mat-divider />

            <div class="setting-group">
              <div class="setting-label">Event filter</div>
              <div class="toggle-row">
                <mat-slide-toggle
                  [checked]="settings()!.rsvpOnly"
                  (change)="saveRsvpOnly($event.checked)">
                  Only show events I've RSVPd to
                </mat-slide-toggle>
              </div>
              <p class="setting-hint">
                When off, all upcoming dinners appear in your calendar. When on, only events
                where you've RSVPd Going or Maybe will appear.
              </p>
            </div>

          </mat-card-content>
        </mat-card>

        <!-- Auto-invite card -->
        <mat-card class="cal-card">
          <mat-card-header>
            <mat-card-title>Auto-Invite Emails</mat-card-title>
            <mat-card-subtitle>Changes save automatically</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="setting-group" style="padding-top:8px">
              <p class="setting-hint" style="margin-bottom:16px">
                When a new dinner is posted, automatically send you a calendar invite email.
                Accept to RSVP Going, Decline to mark yourself Not Going — right from your calendar app.
              </p>
              <mat-radio-group
                class="radio-group"
                [value]="settings()!.autoInvite"
                (change)="saveAutoInvite($event.value)">
                <mat-radio-button value="none">
                  <span class="radio-title">Off</span>
                  <span class="radio-desc">Don't send automatic calendar invites</span>
                </mat-radio-button>
                <mat-radio-button value="city">
                  <span class="radio-title">My city only</span>
                  <span class="radio-desc">Send invites for {{ settings()!.cityName }} dinners only</span>
                </mat-radio-button>
                <mat-radio-button value="all">
                  <span class="radio-title">All cities</span>
                  <span class="radio-desc">Send invites for every new dinner across all chapters</span>
                </mat-radio-button>
              </mat-radio-group>
            </div>
          </mat-card-content>
        </mat-card>

      }
    </div>
  `,
  styles: [`
    .cal-page {
      max-width: 600px;
      margin: 0 auto;
      padding: 24px 16px 80px;
    }
    .page-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--db-brown-dark, #3d2b1f);
      margin: 0 0 8px;
    }
    .page-subtitle {
      color: #666;
      font-size: 0.9rem;
      margin: 0 0 24px;
      line-height: 1.55;
    }
    .loading-center {
      display: flex;
      justify-content: center;
      padding: 48px 0;
    }
    .cal-card {
      margin-bottom: 24px;
      border-radius: 12px;
    }
    .url-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 8px 0 12px;
    }
    .url-input {
      flex: 1;
      font-size: 0.8rem;
      color: #555;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 8px 10px;
      background: #f9f9f9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      font-family: monospace;
    }
    .subscribe-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      a { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem !important; }
    }
    .regen-divider { margin: 16px 0 12px; }
    .regen-hint {
      font-size: 0.82rem;
      color: #888;
      margin: 0 0 8px;
      line-height: 1.5;
    }
    .confirm-inline {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .confirm-text {
      font-size: 0.85rem;
      color: #555;
    }
    .setting-group {
      padding: 16px 0;
    }
    .setting-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    mat-radio-button {
      display: flex;
      align-items: flex-start;
    }
    .radio-title {
      display: block;
      font-weight: 500;
      font-size: 0.92rem;
    }
    .radio-desc {
      display: block;
      font-size: 0.8rem;
      color: #888;
      margin-top: 2px;
    }
    .toggle-row {
      margin-bottom: 8px;
    }
    .setting-hint {
      font-size: 0.82rem;
      color: #888;
      margin: 0;
      line-height: 1.5;
    }
  `],
})
export class ProfileCalendarComponent implements OnInit {
  private readonly calendarService = inject(CalendarService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly settings = signal<CalendarSettings | null>(null);
  readonly regenerating = signal(false);
  readonly showRegenConfirm = signal(false);

  ngOnInit(): void {
    this.calendarService.getSettings().subscribe({
      next: (s) => { this.settings.set(s); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  webcalUrl(): string {
    return (this.settings()?.url ?? '').replace(/^https?:\/\//, 'webcal://');
  }

  googleUrl(): string {
    return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(this.webcalUrl())}`;
  }

  copy(): void {
    const url = this.settings()?.url;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.snackBar.open('Feed URL copied!', 'OK', { duration: 2500 });
    });
  }

  regen(): void {
    this.regenerating.set(true);
    this.showRegenConfirm.set(false);
    this.calendarService.regenerateToken().subscribe({
      next: (res) => {
        this.settings.update((s) => (s ? { ...s, url: res.url } : s));
        this.regenerating.set(false);
        this.snackBar.open('Token regenerated. Update your calendar subscriptions with the new URL.', 'OK', { duration: 6000 });
      },
      error: () => {
        this.regenerating.set(false);
        this.snackBar.open('Something went wrong. Please try again.', 'OK', { duration: 3000 });
      },
    });
  }

  saveCityFilter(value: 'all' | 'city'): void {
    this.calendarService.updateSettings({ cityFilter: value }).subscribe({
      next: (s) => { this.settings.set(s); this.snackBar.open('Saved', '', { duration: 1500 }); },
      error: () => this.snackBar.open('Failed to save.', 'OK', { duration: 3000 }),
    });
  }

  saveRsvpOnly(checked: boolean): void {
    this.calendarService.updateSettings({ rsvpOnly: checked }).subscribe({
      next: (s) => { this.settings.set(s); this.snackBar.open('Saved', '', { duration: 1500 }); },
      error: () => this.snackBar.open('Failed to save.', 'OK', { duration: 3000 }),
    });
  }

  saveAutoInvite(value: 'none' | 'city' | 'all'): void {
    this.calendarService.updateSettings({ autoInvite: value }).subscribe({
      next: (s) => { this.settings.set(s); this.snackBar.open('Saved', '', { duration: 1500 }); },
      error: () => this.snackBar.open('Failed to save.', 'OK', { duration: 3000 }),
    });
  }
}
