import { Component, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventsService, Event, EventStatus } from '../../../core/services/events.service';

export interface EventFormDialogData {
  event?: Event;
  preset?: {
    cityId?: number;
    restaurantId?: number;
    title?: string;
    eventDate?: string;
    eventTime?: string;
  };
}

function nextTuesdayDate(): Date {
  const today = new Date();
  const daysUntil = (2 - today.getDay() + 7) % 7 || 7;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntil);
  return d;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface City { id: number; name: string; }
interface Restaurant { id: number; name: string; cityId: number; }

@Component({
  selector: 'app-event-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.event ? 'Edit Event' : 'Create Event' }}</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="event-form">

        <mat-form-field appearance="outline">
          <mat-label>City</mat-label>
          <mat-select formControlName="cityId">
            @for (city of cities(); track city.id) {
              <mat-option [value]="city.id">{{ city.name }}</mat-option>
            }
          </mat-select>
          <mat-error>City is required</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Restaurant</mat-label>
          <mat-select formControlName="restaurantId">
            @for (r of filteredRestaurants(); track r.id) {
              <mat-option [value]="r.id">{{ r.name }}</mat-option>
            }
          </mat-select>
          <mat-error>Restaurant is required</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Event Title</mat-label>
          <input matInput formControlName="title" placeholder="DinnerBears Cincinnati — June 2026" />
          <mat-error>Title is required</mat-error>
        </mat-form-field>

        <div class="date-time-row">
          <mat-form-field appearance="outline" class="date-field">
            <mat-label>Date</mat-label>
            <input matInput [matDatepicker]="datePicker" formControlName="eventDate" />
            <mat-datepicker-toggle matIconSuffix [for]="datePicker" />
            <mat-datepicker #datePicker />
            <mat-error>Date is required</mat-error>
          </mat-form-field>

          <mat-form-field appearance="outline" class="time-field">
            <mat-label>Time</mat-label>
            <input matInput type="time" formControlName="eventTime" />
            <mat-error>Time is required</mat-error>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput formControlName="description" rows="3"
            placeholder="Join us for a great evening…"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Additional Info</mat-label>
          <textarea matInput formControlName="additionalInfo" rows="2"
            placeholder="Parking, dress code, special notes…"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Status</mat-label>
          <mat-select formControlName="status">
            <mat-option value="draft">Draft</mat-option>
            <mat-option value="published">Published</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Facebook Post Text (optional)</mat-label>
          <textarea matInput formControlName="facebookShareText" rows="3"
            placeholder="Leave blank to auto-generate from event details…"></textarea>
          <mat-hint>Pre-filled text for sharing to Facebook. Auto-generated if empty.</mat-hint>
        </mat-form-field>

        <label class="secret-toggle">
          <input type="checkbox" formControlName="isSecret" />
          Secret dinner (attendees earn a surprise bonus achievement after the event)
        </label>

      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="saving()"
        (click)="save()"
      >
        @if (saving()) { <mat-spinner diameter="18" /> }
        @else { {{ data.event ? 'Save Changes' : 'Create Event' }} }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .event-form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 480px;
      padding-top: 8px;
      mat-form-field { width: 100%; }
    }
    .date-time-row {
      display: flex;
      gap: 12px;
      .date-field { flex: 2; }
      .time-field { flex: 1; }
    }
    .secret-toggle {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.9rem; color: #555; padding: 4px 0;
      input[type=checkbox] { width: 16px; height: 16px; }
    }
  `],
})
export class EventFormDialogComponent implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly eventsService = inject(EventsService);
  private readonly dialogRef = inject(MatDialogRef<EventFormDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);
  private readonly http = inject(HttpClient);
  readonly data = inject<EventFormDialogData>(MAT_DIALOG_DATA);

  readonly cities = signal<City[]>([]);
  readonly restaurants = signal<Restaurant[]>([]);
  readonly filteredRestaurants = signal<Restaurant[]>([]);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    cityId: [0, [Validators.required, Validators.min(1)]],
    restaurantId: [0, [Validators.required, Validators.min(1)]],
    title: ['', Validators.required],
    eventDate: [nextTuesdayDate(), Validators.required],
    eventTime: ['', Validators.required],
    description: [''],
    additionalInfo: [''],
    facebookShareText: [''],
    status: ['draft' as EventStatus],
    isSecret: [false],
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((c) => {
      this.cities.set(c);
    });

    this.http.get<Restaurant[]>('/api/v1/restaurants').subscribe((r) => {
      this.restaurants.set(r);
      const cityId = this.form.controls.cityId.value;
      this.filterRestaurants(cityId);
    });

    this.form.controls.cityId.valueChanges.subscribe((id) => {
      this.filterRestaurants(id);
      this.form.controls.restaurantId.setValue(0);
    });

    this.form.controls.restaurantId.valueChanges.subscribe((id) => {
      if (!id) return;
      const restaurant = this.restaurants().find((r) => r.id === id);
      if (!restaurant) return;

      // Sync city if the selected restaurant is in a different city (edit scenario)
      if (this.form.controls.cityId.value !== restaurant.cityId) {
        this.form.controls.cityId.setValue(restaurant.cityId, { emitEvent: false });
        this.filterRestaurants(restaurant.cityId);
      }

      // Auto-fill title if blank or still matches the generated pattern
      const currentTitle = this.form.controls.title.value;
      if (!currentTitle || /^Bear Dinner at /.test(currentTitle)) {
        this.form.controls.title.setValue(`Bear Dinner at ${restaurant.name}`);
      }
    });

    if (this.data.event) {
      const e = this.data.event;
      this.form.patchValue({
        cityId: e.cityId,
        restaurantId: e.restaurantId ?? 0,
        title: e.title,
        eventDate: parseLocalDate(e.eventDate),
        eventTime: e.eventTime.substring(0, 5),
        description: e.description ?? '',
        additionalInfo: e.additionalInfo ?? '',
        facebookShareText: e.facebookShareText ?? '',
        status: e.status === 'cancelled' ? 'published' : e.status,
        isSecret: e.isSecret ?? false,
      });
    } else if (this.data.preset) {
      const p = this.data.preset;
      this.form.patchValue({
        cityId: p.cityId ?? 0,
        restaurantId: p.restaurantId ?? 0,
        title: p.title ?? '',
        eventDate: p.eventDate ? parseLocalDate(p.eventDate) : nextTuesdayDate(),
        eventTime: p.eventTime ?? '18:30',
      });
      if (p.cityId) this.filterRestaurants(p.cityId);
    } else {
      this.form.patchValue({ eventTime: '18:30' });
    }
  }

  private filterRestaurants(cityId: number): void {
    const all = this.restaurants();
    this.filteredRestaurants.set(cityId ? all.filter((r) => r.cityId === cityId) : all);
  }

  save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);

    const val = this.form.getRawValue();
    const payload = {
      cityId: val.cityId,
      restaurantId: val.restaurantId,
      title: val.title.trim(),
      eventDate: toDateString(val.eventDate),
      eventTime: val.eventTime,
      description: val.description.trim() || null,
      additionalInfo: val.additionalInfo.trim() || null,
      facebookShareText: val.facebookShareText.trim() || null,
      status: val.status as EventStatus,
      isSecret: val.isSecret ?? false,
    };

    const op = this.data.event
      ? this.eventsService.update(this.data.event.id, payload)
      : this.eventsService.create(payload);

    op.subscribe({
      next: (evt) => {
        this.saving.set(false);
        this.dialogRef.close(evt);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save event', 'OK', { duration: 3000 });
      },
    });
  }
}
