import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventsService, Event } from '../../../core/services/events.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventFormDialogComponent } from '../form/event-form-dialog.component';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    DatePipe,
    TitleCasePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (event()) {
      <div class="detail-layout">
        <!-- Photo -->
        @if (event()!.restaurant?.photos?.length) {
          <div class="hero-photo">
            <img [src]="event()!.restaurant!.photos[0].filePath" [alt]="event()!.restaurantName" />
          </div>
        }

        <div class="detail-content">
          <!-- Status chip -->
          @if (event()!.status !== 'published') {
            <div class="status-row">
              <mat-chip [class]="'status-chip status-' + event()!.status">
                {{ event()!.status | titlecase }}
              </mat-chip>
            </div>
          }

          <!-- Title & date -->
          <h1 class="event-title">{{ event()!.title }}</h1>
          <div class="event-datetime">
            <mat-icon>event</mat-icon>
            <span>{{ event()!.eventDate | date: 'EEEE, MMMM d, y' }} at {{ formatTime(event()!.eventTime) }}</span>
          </div>

          <!-- Restaurant info -->
          <mat-card class="info-card">
            <mat-card-content>
              <div class="info-row">
                <mat-icon>restaurant</mat-icon>
                <div>
                  <div class="info-label">Restaurant</div>
                  <div class="info-value">{{ event()!.restaurantName }}</div>
                </div>
              </div>
              <div class="info-row">
                <mat-icon>location_on</mat-icon>
                <div>
                  <div class="info-label">Address</div>
                  <a
                    class="info-value map-link"
                    [href]="mapsUrl()"
                    target="_blank"
                    rel="noopener"
                  >{{ event()!.restaurantAddress }}</a>
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Description -->
          @if (event()!.description) {
            <div class="section">
              <h3>About this event</h3>
              <p class="description">{{ event()!.description }}</p>
            </div>
          }

          <!-- Additional info -->
          @if (event()!.additionalInfo) {
            <div class="section">
              <h3>Additional info</h3>
              <p class="description">{{ event()!.additionalInfo }}</p>
            </div>
          }

          <!-- Cancelled reason -->
          @if (event()!.status === 'cancelled' && event()!.cancelledReason) {
            <div class="cancelled-reason">
              <mat-icon>cancel</mat-icon>
              <span>{{ event()!.cancelledReason }}</span>
            </div>
          }

          <!-- Admin actions -->
          @if (isAdminOrMod()) {
            <div class="admin-actions">
              <button mat-stroked-button (click)="openEdit()">
                <mat-icon>edit</mat-icon> Edit
              </button>
              @if (event()!.status === 'draft') {
                <button mat-raised-button color="primary" (click)="publish()">
                  <mat-icon>publish</mat-icon> Publish
                </button>
              }
              @if (event()!.status === 'published') {
                <button mat-stroked-button color="warn" (click)="cancel()">
                  <mat-icon>cancel</mat-icon> Cancel Event
                </button>
              }
            </div>
          }

          <!-- Back -->
          <div class="back-row">
            <button mat-button (click)="goBack()">
              <mat-icon>arrow_back</mat-icon> All Events
            </button>
          </div>
        </div>
      </div>
    } @else {
      <p class="center">Event not found.</p>
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 48px; }
    .detail-layout { max-width: 760px; margin: 0 auto; }
    .hero-photo {
      width: 100%;
      height: 280px;
      overflow: hidden;
      border-radius: 12px;
      margin-bottom: 24px;
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .status-row { margin-bottom: 12px; }
    .status-chip {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      &.status-draft { background: #e3f2fd; color: #1565c0; }
      &.status-cancelled { background: #ffebee; color: #c62828; }
    }
    .event-title {
      margin: 0 0 12px;
      font-size: 2rem;
      font-weight: 700;
      color: var(--db-brown-dark);
      line-height: 1.2;
    }
    .event-datetime {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.05rem;
      color: var(--db-primary);
      font-weight: 500;
      margin-bottom: 20px;
      mat-icon { color: var(--db-primary); }
    }
    .info-card { margin-bottom: 24px; }
    .info-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #f0ebe3;
      &:last-child { border-bottom: none; }
      mat-icon { color: #999; margin-top: 2px; flex-shrink: 0; }
    }
    .info-label { font-size: 0.75rem; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }
    .info-value { font-size: 0.95rem; color: var(--db-brown-dark); margin-top: 2px; }
    .map-link { color: var(--db-primary); text-decoration: none; &:hover { text-decoration: underline; } }
    .section { margin-bottom: 24px; h3 { margin: 0 0 8px; color: var(--db-brown-dark); } }
    .description { margin: 0; color: #444; line-height: 1.6; white-space: pre-wrap; }
    .cancelled-reason {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: #ffebee;
      border-radius: 8px;
      color: #c62828;
      margin-bottom: 24px;
      mat-icon { color: #c62828; }
    }
    .admin-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 24px;
      padding: 16px;
      background: var(--db-cream-dark);
      border-radius: 8px;
    }
    .back-row { margin-top: 8px; }
  `],
})
export class EventDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly event = signal<Event | null>(null);
  readonly loading = signal(true);

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.eventsService.getOne(id).subscribe({
      next: (e) => { this.event.set(e); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  mapsUrl(): string {
    const e = this.event()!;
    return this.eventsService.mapsUrl(e.restaurantLat, e.restaurantLng, e.restaurantAddress);
  }

  isAdminOrMod(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  openEdit(): void {
    const ref = this.dialog.open(EventFormDialogComponent, {
      data: { event: this.event() },
      width: '600px',
    });
    ref.afterClosed().subscribe((updated: Event | undefined) => {
      if (updated) this.event.set(updated);
    });
  }

  publish(): void {
    const e = this.event()!;
    this.eventsService.update(e.id, { status: 'published' }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.snackBar.open('Event published', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to publish event', 'OK', { duration: 3000 }),
    });
  }

  cancel(): void {
    const reason = window.prompt('Cancellation reason (optional):') ?? '';
    const e = this.event()!;
    this.eventsService.update(e.id, { status: 'cancelled', cancelledReason: reason || null }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.snackBar.open('Event cancelled', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to cancel event', 'OK', { duration: 3000 }),
    });
  }

  goBack(): void {
    void this.router.navigate(['/events']);
  }
}
