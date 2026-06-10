import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventsService, GuestLinkInfo } from '../../../core/services/events.service';

type PageState = 'loading' | 'open' | 'used' | 'expired' | 'cancelled' | 'error' | 'confirmed' | 'cancel-confirm';

@Component({
  selector: 'app-guest-rsvp',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="guest-rsvp-page">
      <div class="brand-header">
        <img src="/assets/logo.png" alt="DinnerBears" class="brand-logo" />
      </div>

      @switch (state()) {
        @case ('loading') {
          <div class="center"><mat-spinner /></div>
        }

        @case ('open') {
          <div class="rsvp-card">
            @if (info()!.restaurantPhotoUrl) {
              <div class="event-photo">
                <img [src]="info()!.restaurantPhotoUrl!" [alt]="info()!.restaurantName" />
              </div>
            }

            <div class="card-body">
              <p class="invited-by">
                <mat-icon class="invite-icon">celebration</mat-icon>
                <strong>{{ info()!.invitedByName }}</strong> invited you to dinner!
              </p>

              <h1 class="event-title">{{ info()!.eventTitle }}</h1>

              <div class="event-meta">
                <div class="meta-row">
                  <mat-icon>event</mat-icon>
                  <span>{{ info()!.eventDate | date: 'EEEE, MMMM d, y' }} at {{ formatTime(info()!.eventTime) }}</span>
                </div>
                <div class="meta-row">
                  <mat-icon>restaurant</mat-icon>
                  <span>{{ info()!.restaurantName }}</span>
                </div>
                <div class="meta-row">
                  <mat-icon>location_on</mat-icon>
                  <a [href]="mapsUrl()" target="_blank" rel="noopener" class="address-link">
                    {{ info()!.restaurantAddress }}
                  </a>
                </div>
              </div>

              <div class="name-section">
                <mat-form-field appearance="outline" class="name-field">
                  <mat-label>Your name</mat-label>
                  <input matInput [formControl]="nameCtrl" placeholder="Enter your name" maxlength="200" />
                </mat-form-field>
              </div>

              <button
                mat-raised-button
                color="primary"
                class="rsvp-btn"
                [disabled]="submitting()"
                (click)="confirm()"
              >
                @if (submitting()) {
                  <mat-spinner diameter="20" />
                } @else {
                  <ng-container>
                    <mat-icon>check_circle</mat-icon>
                    I'll be there!
                  </ng-container>
                }
              </button>

              @if (errorMsg()) {
                <p class="error-msg">{{ errorMsg() }}</p>
              }
            </div>
          </div>
        }

        @case ('confirmed') {
          <div class="rsvp-card">
            <div class="card-body state-body">
              <mat-icon class="state-icon confirmed-icon">check_circle</mat-icon>
              <h2>You're going!</h2>
              <p>See you at <strong>{{ info()!.restaurantName }}</strong> on {{ info()!.eventDate | date: 'MMMM d' }}.</p>
              <p class="state-sub">{{ info()!.invitedByName }} will have your spot reserved.</p>
              <div class="join-cta">
                <p class="join-text">Want to discover future dinners and join the group?</p>
                <a mat-raised-button color="primary" href="/login" class="join-btn">
                  <mat-icon>group_add</mat-icon>
                  Join DinnerBears
                </a>
              </div>
            </div>
          </div>
        }

        @case ('used') {
          <div class="rsvp-card">
            <div class="card-body state-body">
              <mat-icon class="state-icon used-icon">check_circle</mat-icon>
              <h2>Already RSVP'd!</h2>
              <p>You're confirmed for <strong>{{ info()!.restaurantName }}</strong> on {{ info()!.eventDate | date: 'MMMM d' }}.</p>
              <p class="state-sub">See you there!</p>
              <button mat-stroked-button color="warn" class="cancel-btn" [disabled]="cancelling()" (click)="cancelRsvp()">
                @if (cancelling()) { <mat-spinner diameter="16" /> } @else { Can't make it anymore }
              </button>
              <div class="join-cta">
                <p class="join-text">Want to discover future dinners and join the group?</p>
                <a mat-raised-button color="primary" href="/login" class="join-btn">
                  <mat-icon>group_add</mat-icon>
                  Join DinnerBears
                </a>
              </div>
            </div>
          </div>
        }

        @case ('cancel-confirm') {
          <div class="rsvp-card">
            <div class="card-body state-body">
              <mat-icon class="state-icon expired-icon">sentiment_dissatisfied</mat-icon>
              <h2>You're cancelled</h2>
              <p>We'll let {{ info()!.invitedByName }} know.</p>
              <button mat-stroked-button color="primary" class="cancel-btn" (click)="reopen()">
                Actually, I can make it!
              </button>
            </div>
          </div>
        }

        @case ('expired') {
          <div class="rsvp-card">
            <div class="card-body state-body">
              <mat-icon class="state-icon expired-icon">schedule</mat-icon>
              <h2>This link has expired</h2>
              <p>The dinner was on {{ info()!.eventDate | date: 'MMMM d, y' }}.</p>
            </div>
          </div>
        }

        @case ('cancelled') {
          <div class="rsvp-card">
            <div class="card-body state-body">
              <mat-icon class="state-icon expired-icon">cancel</mat-icon>
              <h2>Event cancelled</h2>
              <p>Unfortunately <strong>{{ info()!.eventTitle }}</strong> has been cancelled.</p>
            </div>
          </div>
        }

        @case ('error') {
          <div class="rsvp-card">
            <div class="card-body state-body">
              <mat-icon class="state-icon error-icon">error_outline</mat-icon>
              <h2>Link not found</h2>
              <p>This invite link is invalid or has been removed.</p>
            </div>
          </div>
        }
      }

      <p class="footer-brand">DinnerBears &mdash; Good food. Great company. Bear memories.</p>
    </div>
  `,
  styles: [`
    .guest-rsvp-page {
      min-height: 100vh;
      background: var(--db-cream, #fdfaf5);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px 48px;
    }

    .brand-header {
      margin-bottom: 28px;
    }

    .brand-logo {
      height: 64px;
      width: auto;
      filter: drop-shadow(0 2px 6px rgba(61,28,5,0.25));
    }

    .center {
      display: flex;
      justify-content: center;
      padding: 60px;
    }

    .rsvp-card {
      width: 100%;
      max-width: 520px;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(61,28,5,0.1);
      overflow: hidden;
    }

    .event-photo {
      width: 100%;
      height: 200px;
      overflow: hidden;
      img { width: 100%; height: 100%; object-fit: cover; }
    }

    .card-body {
      padding: 28px 28px 32px;
    }

    .invited-by {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      color: #666;
      margin: 0 0 16px;
    }

    .invite-icon {
      color: var(--db-amber, #c9933a);
      font-size: 1.2rem;
      width: 1.2rem;
      height: 1.2rem;
    }

    .event-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--db-brown-dark, #3d1c05);
      margin: 0 0 20px;
      line-height: 1.25;
    }

    .event-meta {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 24px;
      padding: 16px;
      background: #faf7f2;
      border-radius: 10px;
    }

    .meta-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 0.92rem;
      color: #444;
      mat-icon { color: #999; font-size: 1.1rem; width: 1.1rem; height: 1.1rem; flex-shrink: 0; margin-top: 1px; }
    }

    .address-link {
      color: var(--db-primary, #1e4d8c);
      text-decoration: none;
      &:hover { text-decoration: underline; }
    }

    .name-section { margin-bottom: 20px; }

    .name-field { width: 100%; }

    .rsvp-btn {
      width: 100%;
      height: 48px;
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .error-msg {
      margin: 12px 0 0;
      font-size: 0.85rem;
      color: #c62828;
      text-align: center;
    }

    .state-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 40px 28px;
      gap: 8px;

      h2 { margin: 0; font-size: 1.4rem; color: var(--db-brown-dark, #3d1c05); }
      p { margin: 4px 0 0; color: #555; font-size: 0.95rem; line-height: 1.5; }
    }

    .state-icon {
      font-size: 3rem;
      width: 3rem;
      height: 3rem;
      margin-bottom: 8px;
    }

    .confirmed-icon, .used-icon { color: #2e7d32; }
    .expired-icon { color: #999; }
    .error-icon { color: #c62828; }

    .state-sub { color: #999 !important; font-size: 0.85rem !important; }

    .cancel-btn {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .join-cta {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #f0ebe3;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .join-text {
      margin: 0 !important;
      font-size: 0.9rem !important;
      color: #555 !important;
    }

    .join-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }

    .footer-brand {
      margin-top: 32px;
      font-size: 0.8rem;
      color: #bbb;
      font-style: italic;
      text-align: center;
    }
  `],
})
export class GuestRsvpComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly eventsService = inject(EventsService);

  readonly state = signal<PageState>('loading');
  readonly info = signal<GuestLinkInfo | null>(null);
  readonly submitting = signal(false);
  readonly cancelling = signal(false);
  readonly errorMsg = signal<string | null>(null);

  readonly nameCtrl = new FormControl<string>('', { nonNullable: true });

  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.state.set('error');
      return;
    }

    this.eventsService.getGuestLinkInfo(this.token).subscribe({
      next: (info) => {
        this.info.set(info);
        if (info.eventStatus === 'cancelled') {
          this.state.set('cancelled');
        } else if (info.cancelledAt) {
          this.state.set('cancel-confirm');
        } else if (info.usedAt) {
          this.state.set('used');
        } else if (new Date() > new Date(info.expiresAt)) {
          this.state.set('expired');
        } else {
          this.nameCtrl.setValue(info.recipientName ?? '');
          this.state.set('open');
        }
      },
      error: () => this.state.set('error'),
    });
  }

  confirm(): void {
    this.errorMsg.set(null);
    this.submitting.set(true);
    const name = this.nameCtrl.value.trim() || undefined;

    this.eventsService.confirmGuestRsvp(this.token, name).subscribe({
      next: () => {
        this.submitting.set(false);
        this.state.set('confirmed');
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMsg.set(err?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }

  cancelRsvp(): void {
    this.cancelling.set(true);
    this.eventsService.cancelGuestRsvp(this.token).subscribe({
      next: () => { this.cancelling.set(false); this.state.set('cancel-confirm'); },
      error: () => { this.cancelling.set(false); },
    });
  }

  reopen(): void {
    this.nameCtrl.setValue(this.info()!.recipientName ?? '');
    this.state.set('open');
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  mapsUrl(): string {
    const info = this.info()!;
    return this.eventsService.mapsUrl(info.restaurantLat, info.restaurantLng, info.restaurantAddress);
  }
}
