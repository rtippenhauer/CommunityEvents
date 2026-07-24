import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { AppConfigService } from '../../../core/services/app-config.service';

const WEEKDAYS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="settings-admin-container">
      <h2 class="page-title">Site Settings</h2>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else {
        <mat-card>
          <mat-card-header>
            <mat-card-title>Location Privacy</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="form">
              <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
                <mat-label>Default for new locations</mat-label>
                <mat-select formControlName="locationPrivacyDefault">
                  <mat-option value="public">Public — address always visible</mat-option>
                  <mat-option value="private">Private — hidden until RSVP</mat-option>
                </mat-select>
                <mat-hint>
                  Applies only when a location is created — each location's privacy can still be
                  overridden individually from its edit form.
                </mat-hint>
              </mat-form-field>
            </form>
          </mat-card-content>
        </mat-card>

        <mat-card>
          <mat-card-header>
            <mat-card-title>New Event Default</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="form" class="cadence-form">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Day of week</mat-label>
                <mat-select formControlName="eventCadenceWeekday">
                  @for (day of weekdays; track day.value) {
                    <mat-option [value]="day.value">{{ day.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Time</mat-label>
                <input matInput type="time" formControlName="eventCadenceTime" />
              </mat-form-field>
            </form>
            <p class="cadence-hint">
              New events default to the next occurrence of this day/time. Only a fixed weekly
              cadence is supported today — a monthly ("2nd Saturday") pattern isn't built yet.
            </p>
          </mat-card-content>
        </mat-card>

        <button mat-raised-button color="primary" (click)="save()" [disabled]="saving()">
          <mat-icon>save</mat-icon> {{ saving() ? 'Saving…' : 'Save' }}
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .settings-admin-container {
        max-width: 640px;
        margin: 0 auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .page-title {
        margin: 0;
        color: var(--db-brown-dark);
      }
      .full-width {
        width: 100%;
      }
      .cadence-form {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        mat-form-field {
          flex: 1;
          min-width: 160px;
        }
      }
      .cadence-hint {
        margin: 8px 0 0;
        font-size: 0.78rem;
        color: #888;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
    `,
  ],
})
export class AdminSettingsComponent implements OnInit {
  private readonly appConfigService = inject(AppConfigService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly weekdays = WEEKDAYS;

  readonly form = this.fb.group({
    locationPrivacyDefault: this.fb.control<'public' | 'private'>('public'),
    eventCadenceWeekday: this.fb.control('2'),
    eventCadenceTime: this.fb.control('18:30'),
  });

  ngOnInit(): void {
    this.appConfigService.getSiteSettings().subscribe({
      next: (settings) => {
        const byKey = new Map(settings.map((s) => [s.configKey, s.configValue]));
        this.form.patchValue({
          locationPrivacyDefault:
            (byKey.get('location_privacy_default') as 'public' | 'private' | undefined) ?? 'public',
          eventCadenceWeekday: byKey.get('event_cadence_weekday') ?? '2',
          eventCadenceTime: byKey.get('event_cadence_time') ?? '18:30',
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  save(): void {
    this.saving.set(true);
    const val = this.form.getRawValue();
    forkJoin([
      this.appConfigService.updateValue('location_privacy_default', val.locationPrivacyDefault),
      this.appConfigService.updateValue('event_cadence_weekday', val.eventCadenceWeekday),
      this.appConfigService.updateValue('event_cadence_time', val.eventCadenceTime),
    ]).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open('Settings saved', 'OK', { duration: 3000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save settings', 'OK', { duration: 3000 });
      },
    });
  }
}
