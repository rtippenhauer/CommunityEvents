import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DatePipe, SlicePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventsService, Event } from '../../../core/services/events.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventFormDialogComponent } from '../form/event-form-dialog.component';

interface City {
  id: number;
  name: string;
}

@Component({
  selector: 'app-events-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    SlicePipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  template: `
    @if (!isLoggedIn()) {
      <div class="guest-banner">
        <span>Join DinnerBears to RSVP for events.</span>
        <a mat-stroked-button routerLink="/login">Sign in</a>
      </div>
    }

    <div class="page-header">
      <h1>Upcoming Dinners</h1>
      @if (isAdminOrMod()) {
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> Create Event
        </button>
      }
    </div>

    <!-- Filters -->
    <div class="filters">
      <mat-button-toggle-group [formControl]="upcomingCtrl" class="toggle-group">
        <mat-button-toggle [value]="true">Upcoming</mat-button-toggle>
        <mat-button-toggle [value]="false">Past</mat-button-toggle>
      </mat-button-toggle-group>

      <mat-form-field appearance="outline" class="city-field">
        <mat-label>City</mat-label>
        <mat-select [formControl]="cityCtrl">
          <mat-option [value]="null">All cities</mat-option>
          @for (city of cities(); track city.id) {
            <mat-option [value]="city.id">{{ city.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    <!-- Events -->
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (events().length === 0) {
      <p class="empty">No {{ upcomingCtrl.value ? 'upcoming' : 'past' }} events found.</p>
    } @else {
      <div class="events-grid">
        @for (e of events(); track e.id) {
          <mat-card
            class="event-card"
            [class.cancelled]="e.status === 'cancelled'"
            (click)="goToDetail(e.id)"
            role="button"
            tabindex="0"
            (keydown.enter)="goToDetail(e.id)"
          >
            <div class="card-photo">
              @if (e.restaurant?.photos?.length) {
                <img [src]="e.restaurant!.photos[0].filePath" [alt]="e.restaurantName" />
              } @else {
                <div class="photo-placeholder">🍽️</div>
              }
              @if (e.status === 'cancelled') {
                <div class="cancelled-overlay">CANCELLED</div>
              }
            </div>
            <mat-card-content class="card-body">
              <div class="event-date">
                {{ e.eventDate | date: 'EEE, MMM d, y' }} at {{ formatTime(e.eventTime) }}
              </div>
              <h3 class="event-title" [class.cancelled-title]="e.status === 'cancelled'">
                @if (e.status === 'cancelled') { <span class="cancelled-prefix">CANCELLED:</span> }
                {{ e.title }}
              </h3>
              <p class="event-restaurant">
                <mat-icon class="inline-icon">restaurant</mat-icon>
                {{ e.restaurantName }}
              </p>
              <p class="event-city">{{ e.city.name }}</p>
              @if (e.description) {
                <p class="event-desc">
                  {{ e.description | slice: 0 : 100 }}{{ e.description.length > 100 ? '…' : '' }}
                </p>
              }
            </mat-card-content>
          </mat-card>
        }
      </div>
    }
  `,
  styles: [`
    .guest-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--db-cream-dark);
      border: 1px solid #e0d8cc;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 0.95rem;
      color: var(--db-brown-dark);
      gap: 16px;
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      h1 { margin: 0; font-size: 1.75rem; color: var(--db-brown-dark); }
    }
    .filters {
      display: flex;
      gap: 16px;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .toggle-group { height: 40px; }
    .city-field { width: 180px; margin-bottom: -1.25em; }
    .events-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    .event-card {
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.15s;
      overflow: hidden;
      &:hover { box-shadow: 0 6px 20px rgba(61,28,5,0.18); transform: translateY(-2px); }
      &.cancelled { opacity: 0.65; }
    }
    .card-photo {
      position: relative;
      height: 160px;
      overflow: hidden;
      background: var(--db-cream-dark);
      img { width: 100%; height: 100%; object-fit: cover; display: block; }
    }
    .photo-placeholder {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
    }
    .cancelled-overlay {
      position: absolute;
      inset: 0;
      background: rgba(180, 0, 0, 0.72);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      color: #fff;
      text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .cancelled-title { color: #b00000; }
    .cancelled-prefix { font-weight: 700; margin-right: 4px; }
    .card-body { padding: 12px 16px 16px; }
    .event-date {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--db-primary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 4px;
    }
    .event-title { margin: 0 0 6px; font-size: 1.1rem; font-weight: 600; color: var(--db-brown-dark); }
    .event-restaurant {
      margin: 0 0 2px;
      font-size: 0.85rem;
      color: #555;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .inline-icon { font-size: 1rem; width: 1rem; height: 1rem; }
    .event-city { margin: 0 0 8px; font-size: 0.8rem; color: #888; }
    .event-desc { margin: 0; font-size: 0.85rem; color: #555; line-height: 1.4; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: #999; padding: 48px 0; }
  `],
})
export class EventsListComponent implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly events = signal<Event[]>([]);
  readonly cities = signal<City[]>([]);
  readonly loading = signal(true);

  readonly upcomingCtrl = new FormControl<boolean>(true, { nonNullable: true });
  readonly cityCtrl = new FormControl<number | null>(null);

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((c) => this.cities.set(c));
    this.load();
    this.upcomingCtrl.valueChanges.subscribe(() => this.load());
    this.cityCtrl.valueChanges.subscribe(() => this.load());
  }

  load(): void {
    this.loading.set(true);
    this.eventsService.getAll({
      cityId: this.cityCtrl.value ?? undefined,
      upcoming: this.upcomingCtrl.value,
    }).subscribe({
      next: (evts) => { this.events.set(evts); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  isAdminOrMod(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  goToDetail(id: number): void {
    void this.router.navigate(['/events', id]);
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  openCreate(): void {
    const ref = this.dialog.open(EventFormDialogComponent, {
      data: {},
      width: '600px',
    });
    ref.afterClosed().subscribe((created: Event | undefined) => {
      if (created) this.load();
    });
  }
}
