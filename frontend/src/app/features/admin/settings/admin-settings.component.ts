import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { BrandConfigService } from '../../../core/services/brand-config.service';

const WEEKDAYS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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
            <mat-card-title>Branding</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="form">
              <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
                <mat-label>App name</mat-label>
                <input matInput formControlName="brandName" />
                <mat-hint>Shown in the nav, footer, and browser tab title.</mat-hint>
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
                <mat-label>Tagline</mat-label>
                <input matInput formControlName="brandTagline" />
                <mat-hint>Shown on the login page and in the footer.</mat-hint>
              </mat-form-field>

              <div class="color-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Primary color</mat-label>
                  <input matInput formControlName="colorPrimary" placeholder="#C9933A" />
                  @if (form.controls.colorPrimary.invalid && form.controls.colorPrimary.dirty) {
                    <mat-error>Enter a 6-digit hex color like #C9933A</mat-error>
                  }
                </mat-form-field>
                <input
                  type="color"
                  class="color-swatch"
                  [value]="swatchValue(form.controls.colorPrimary.value)"
                  (input)="onSwatchChange('colorPrimary', $event)"
                  aria-label="Pick primary color"
                />
              </div>

              <div class="color-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Accent color</mat-label>
                  <input matInput formControlName="colorAccent" placeholder="#C9933A" />
                  @if (form.controls.colorAccent.invalid && form.controls.colorAccent.dirty) {
                    <mat-error>Enter a 6-digit hex color like #C9933A</mat-error>
                  }
                </mat-form-field>
                <input
                  type="color"
                  class="color-swatch"
                  [value]="swatchValue(form.controls.colorAccent.value)"
                  (input)="onSwatchChange('colorAccent', $event)"
                  aria-label="Pick accent color"
                />
              </div>

              <div class="color-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Background color</mat-label>
                  <input matInput formControlName="colorBackground" placeholder="#FDFAF5" />
                  @if (form.controls.colorBackground.invalid && form.controls.colorBackground.dirty) {
                    <mat-error>Enter a 6-digit hex color like #FDFAF5</mat-error>
                  }
                </mat-form-field>
                <input
                  type="color"
                  class="color-swatch"
                  [value]="swatchValue(form.controls.colorBackground.value)"
                  (input)="onSwatchChange('colorBackground', $event)"
                  aria-label="Pick background color"
                />
              </div>
            </form>
            <p class="cadence-hint">
              Applies immediately, no rebuild needed. Hover/derived shades (button hover states,
              nav sidebar) aren't auto-generated from these — a very different hue may look
              slightly off there until that's built.
            </p>
          </mat-card-content>
        </mat-card>

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

        <button
          mat-raised-button
          color="primary"
          (click)="save()"
          [disabled]="saving() || form.invalid"
        >
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
        margin-bottom: 12px;
      }
      .color-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 12px;
        mat-form-field {
          flex: 1;
        }
      }
      .color-swatch {
        width: 40px;
        height: 40px;
        margin-top: 4px;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 0;
        cursor: pointer;
        background: none;
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
  private readonly brandConfigService = inject(BrandConfigService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly weekdays = WEEKDAYS;

  readonly form = this.fb.group({
    brandName: this.fb.control('DinnerBears'),
    brandTagline: this.fb.control('Good food. Great company. Bear memories.'),
    colorPrimary: this.fb.control('#C9933A', [Validators.pattern(HEX_COLOR_PATTERN)]),
    colorAccent: this.fb.control('#C9933A', [Validators.pattern(HEX_COLOR_PATTERN)]),
    colorBackground: this.fb.control('#FDFAF5', [Validators.pattern(HEX_COLOR_PATTERN)]),
    locationPrivacyDefault: this.fb.control<'public' | 'private'>('public'),
    eventCadenceWeekday: this.fb.control('2'),
    eventCadenceTime: this.fb.control('18:30'),
  });

  ngOnInit(): void {
    this.appConfigService.getSiteSettings().subscribe({
      next: (settings) => {
        const byKey = new Map(settings.map((s) => [s.configKey, s.configValue]));
        this.form.patchValue({
          brandName: byKey.get('brand_name') ?? 'DinnerBears',
          brandTagline: byKey.get('brand_tagline') ?? 'Good food. Great company. Bear memories.',
          colorPrimary: byKey.get('theme_color_primary') ?? '#C9933A',
          colorAccent: byKey.get('theme_color_accent') ?? '#C9933A',
          colorBackground: byKey.get('theme_color_background') ?? '#FDFAF5',
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

  swatchValue(hex: string): string {
    return HEX_COLOR_PATTERN.test(hex) ? hex : '#000000';
  }

  onSwatchChange(control: 'colorPrimary' | 'colorAccent' | 'colorBackground', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.controls[control].setValue(value);
    this.form.controls[control].markAsDirty();
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const val = this.form.getRawValue();
    forkJoin([
      this.appConfigService.updateValue('brand_name', val.brandName),
      this.appConfigService.updateValue('brand_tagline', val.brandTagline),
      this.appConfigService.updateValue('theme_color_primary', val.colorPrimary),
      this.appConfigService.updateValue('theme_color_accent', val.colorAccent),
      this.appConfigService.updateValue('theme_color_background', val.colorBackground),
      this.appConfigService.updateValue('location_privacy_default', val.locationPrivacyDefault),
      this.appConfigService.updateValue('event_cadence_weekday', val.eventCadenceWeekday),
      this.appConfigService.updateValue('event_cadence_time', val.eventCadenceTime),
    ]).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open('Settings saved', 'OK', { duration: 3000 });
        void this.brandConfigService.init();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save settings', 'OK', { duration: 3000 });
      },
    });
  }
}
