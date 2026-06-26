import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventsService, ReservationConfirmInfo } from '../../../core/services/events.service';

type PageState = 'loading' | 'ready' | 'confirming' | 'confirmed' | 'error';

@Component({
  selector: 'app-reservation-confirm',
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="confirm-layout">
      <div class="confirm-card">
        <div class="card-header">
          <img src="/assets/logo.png" alt="DinnerBears" class="logo" />
        </div>

        @if (state() === 'loading') {
          <div class="state-body center">
            <mat-spinner diameter="40" />
            <p>Loading event details…</p>
          </div>

        } @else if (state() === 'error') {
          <div class="state-body error-state">
            <mat-icon class="state-icon error-icon">error_outline</mat-icon>
            <h2>Link not found</h2>
            <p>This confirmation link is invalid or has already expired.</p>
            <a mat-stroked-button routerLink="/">Go to DinnerBears</a>
          </div>

        } @else if (state() === 'confirmed') {
          <div class="state-body success-state">
            <mat-icon class="state-icon success-icon">check_circle</mat-icon>
            <h2>Reservation confirmed!</h2>
            <p class="success-sub">Thanks for making the reservation. The group has been notified.</p>
            <div class="event-details">
              <div class="detail-row">
                <mat-icon>restaurant</mat-icon>
                <span>{{ info()!.restaurantName }}</span>
              </div>
              <div class="detail-row">
                <mat-icon>event</mat-icon>
                <span>{{ (info()!.eventDate + 'T12:00:00') | date: 'EEEE, MMMM d, y' }} at {{ formatTime(info()!.eventTime) }}</span>
              </div>
            </div>
          </div>

        } @else {
          <!-- ready or confirming — show event info + confirm button -->
          <div class="state-body ready-state">
            <h2>Confirm the Reservation</h2>
            <p class="ready-sub">You've been asked to make the reservation for this event. Once you've called the restaurant, click the button below.</p>
            <div class="event-details">
              <div class="detail-row">
                <mat-icon>dining</mat-icon>
                <span><strong>{{ info()!.eventTitle }}</strong></span>
              </div>
              <div class="detail-row">
                <mat-icon>restaurant</mat-icon>
                <span>{{ info()!.restaurantName }}</span>
              </div>
              <div class="detail-row">
                <mat-icon>event</mat-icon>
                <span>{{ (info()!.eventDate + 'T12:00:00') | date: 'EEEE, MMMM d, y' }} at {{ formatTime(info()!.eventTime) }}</span>
              </div>
            </div>
            <div class="confirm-action">
              <button mat-raised-button color="primary" class="confirm-btn"
                [disabled]="state() === 'confirming'"
                (click)="confirm()">
                @if (state() === 'confirming') {
                  <mat-spinner diameter="18" />
                } @else {
                  <mat-icon>check</mat-icon>
                }
                I Made the Reservation
              </button>
              <p class="confirm-hint">This will notify the group that the reservation is confirmed.</p>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .confirm-layout {
      min-height: 100vh;
      background: #F5EDD8;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .confirm-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(61,28,5,0.12);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
    }
    .card-header {
      background: #3D1C05;
      padding: 20px;
      text-align: center;
    }
    .logo { height: 80px; display: inline-block; }
    .state-body {
      padding: 36px 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 12px;
      h2 { margin: 0; font-size: 1.35rem; font-weight: 700; color: #3D1C05; }
      p { margin: 0; color: #555; font-size: 0.92rem; line-height: 1.5; }
    }
    .center { gap: 16px; color: #888; }
    .state-icon { font-size: 3rem; width: 3rem; height: 3rem; }
    .success-icon { color: #2e7d32; }
    .error-icon { color: #c62828; }
    .success-sub, .ready-sub { color: #555; max-width: 360px; }
    .event-details {
      background: #faf7f2;
      border: 1px solid #e8e0d6;
      border-radius: 8px;
      padding: 14px 18px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 4px;
      text-align: left;
    }
    .detail-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.9rem;
      color: #444;
      mat-icon { color: #C9933A; font-size: 1.1rem; width: 1.1rem; height: 1.1rem; flex-shrink: 0; }
    }
    .confirm-action {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      width: 100%;
    }
    .confirm-btn {
      min-width: 220px;
      font-size: 1rem;
      font-weight: 700;
      padding: 10px 24px;
      display: flex;
      align-items: center;
      gap: 6px;
      mat-spinner { display: inline-block; }
    }
    .confirm-hint { font-size: 0.78rem; color: #999; }
  `],
})
export class ReservationConfirmComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly eventsService = inject(EventsService);

  readonly state = signal<PageState>('loading');
  readonly info = signal<ReservationConfirmInfo | null>(null);
  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.eventsService.getReservationInfo(this.token).subscribe({
      next: (result) => {
        this.info.set(result);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  confirm(): void {
    this.state.set('confirming');
    this.eventsService.confirmReservation(this.token).subscribe({
      next: (result) => {
        this.info.set(result);
        this.state.set('confirmed');
      },
      error: () => this.state.set('error'),
    });
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}
