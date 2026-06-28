import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { EventsService, Event } from '../../../core/services/events.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventCardComponent } from '../../../shared/components/event-card/event-card.component';
import { EventFormDialogComponent } from '../form/event-form-dialog.component';
import { CalendarSubscribeComponent } from '../../../shared/components/calendar-subscribe/calendar-subscribe.component';

interface City {
  id: number;
  name: string;
}

@Component({
  selector: 'app-events-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    EventCardComponent,
    CalendarSubscribeComponent,
  ],
  template: `
    @if (!isLoggedIn()) {
      <div class="guest-banner">
        <span>Join DinnerBears to RSVP for events.</span>
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
    @if (isLoggedIn()) {
      <div class="cal-sub-bar">
        <app-calendar-subscribe />
      </div>
    }

    <!-- Filters -->
    <div class="filters">
      <mat-form-field appearance="outline" class="date-field">
        <mat-label>Show from</mat-label>
        <input matInput [matDatepicker]="picker" [formControl]="fromDateCtrl" />
        <mat-datepicker-toggle matIconSuffix [for]="picker" />
        <mat-datepicker #picker />
      </mat-form-field>

      <mat-form-field appearance="outline" class="city-field">
        <mat-label>City</mat-label>
        <mat-select [formControl]="cityCtrl">
          <mat-option [value]="null">All cities</mat-option>
          @for (city of cities(); track city.id) {
            <mat-option [value]="city.id">{{ city.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (isLoggedIn()) {
        <mat-checkbox [checked]="myOnly()" (change)="myOnly.set($event.checked)" class="my-only-check">My events only</mat-checkbox>
      }
    </div>

    <!-- Events -->
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (displayEvents().length === 0) {
      <p class="empty">No events found from this date.</p>
    } @else {
      <div class="events-grid">
        @for (e of displayEvents(); track e.id) {
          <app-event-card [event]="e" />
        }
      </div>
    }
  `,
  styles: [`
    .guest-banner {
      display: flex;
      align-items: center;
      background: var(--db-cream-dark);
      border: 1px solid #e0d8cc;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 0.95rem;
      color: var(--db-brown-dark);
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      h1 { margin: 0; font-size: 1.75rem; color: var(--db-brown-dark); }
    }
    .cal-sub-bar {
      margin-bottom: 16px;
    }
    .filters {
      display: flex;
      gap: 16px;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .date-field { width: 160px; margin-bottom: -1.25em; }
    .city-field { width: 180px; margin-bottom: -1.25em; }
    .events-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    .my-only-check { font-size: 0.85rem; white-space: nowrap; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: #999; padding: 48px 0; }
  `],
})
export class EventsListComponent implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly http = inject(HttpClient);

  readonly events = signal<Event[]>([]);
  readonly cities = signal<City[]>([]);
  readonly loading = signal(true);

  readonly fromDateCtrl = new FormControl<Date>(new Date(), { nonNullable: true });
  readonly cityCtrl = new FormControl<number | null>(null);
  readonly myOnly = signal(false);

  readonly displayEvents = computed(() => {
    if (!this.myOnly()) return this.events();
    return this.events().filter((e) => e.myRsvpStatus === 'going' || e.myRsvpStatus === 'maybe');
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((c) => this.cities.set(c));
    this.load();
    this.fromDateCtrl.valueChanges.subscribe(() => this.load());
    this.cityCtrl.valueChanges.subscribe(() => this.load());
  }

  load(): void {
    this.loading.set(true);
    const d = this.fromDateCtrl.value;
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) {
      this.loading.set(false);
      return;
    }
    const fromDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.eventsService.getAll({
      cityId: this.cityCtrl.value ?? undefined,
      fromDate,
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
