import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { AppConfigService, BrandImageSlot } from '../../../core/services/app-config.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { AvatarsService, Avatar } from '../../../core/services/avatars.service';
import { stripLogoBackground } from '../../../shared/utils/strip-logo-background';

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
    MatSlideToggleModule,
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

            <div class="brand-images">
              <h3 class="images-title">Images</h3>

              <div class="image-row">
                <div class="image-preview logo-preview">
                  <img [src]="brandConfigService.logoSrc()" alt="Logo preview" />
                </div>
                <div class="image-controls">
                  <div class="image-label">Logo <span>— nav bar &amp; footer wordmark</span></div>
                  <div class="image-actions">
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="logoInput.click()"
                      [disabled]="uploadingSlot() === 'logo'"
                    >
                      <mat-icon>upload</mat-icon>
                      {{ uploadingSlot() === 'logo' ? 'Uploading…' : 'Upload' }}
                    </button>
                    @if (brandConfigService.brand().logoUrl) {
                      <button
                        mat-button
                        type="button"
                        (click)="resetImage('logo')"
                        [disabled]="uploadingSlot() === 'logo'"
                      >
                        Reset
                      </button>
                    }
                    <input
                      #logoInput
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      (change)="onImageSelected('logo', $event)"
                    />
                  </div>
                </div>
              </div>

              <div class="image-row">
                <div class="image-preview splash-preview">
                  <img [src]="brandConfigService.splashSrc()" alt="Splash preview" />
                </div>
                <div class="image-controls">
                  <div class="image-label">Splash <span>— login page hero image</span></div>
                  <div class="image-actions">
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="splashInput.click()"
                      [disabled]="uploadingSlot() === 'splash'"
                    >
                      <mat-icon>upload</mat-icon>
                      {{ uploadingSlot() === 'splash' ? 'Uploading…' : 'Upload' }}
                    </button>
                    @if (brandConfigService.brand().splashUrl) {
                      <button
                        mat-button
                        type="button"
                        (click)="resetImage('splash')"
                        [disabled]="uploadingSlot() === 'splash'"
                      >
                        Reset
                      </button>
                    }
                    <input
                      #splashInput
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      (change)="onImageSelected('splash', $event)"
                    />
                  </div>
                </div>
              </div>

              <div class="image-row">
                <div class="image-preview icon-preview">
                  <img [src]="brandConfigService.iconSrc()" alt="Icon preview" />
                </div>
                <div class="image-controls">
                  <div class="image-label">Icon <span>— favicon &amp; small app marks</span></div>
                  <div class="image-actions">
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="iconInput.click()"
                      [disabled]="uploadingSlot() === 'icon'"
                    >
                      <mat-icon>upload</mat-icon>
                      {{ uploadingSlot() === 'icon' ? 'Uploading…' : 'Upload' }}
                    </button>
                    @if (brandConfigService.brand().iconUrl) {
                      <button
                        mat-button
                        type="button"
                        (click)="resetImage('icon')"
                        [disabled]="uploadingSlot() === 'icon'"
                      >
                        Reset
                      </button>
                    }
                    <input
                      #iconInput
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      (change)="onImageSelected('icon', $event)"
                    />
                  </div>
                </div>
              </div>

              <div class="image-row">
                <div class="image-preview splash-preview">
                  @if (brandConfigService.brand().storyUrl) {
                    <img [src]="brandConfigService.brand().storyUrl" alt="Story image preview" />
                  } @else {
                    <span class="no-image-hint">None</span>
                  }
                </div>
                <div class="image-controls">
                  <div class="image-label">
                    Story Brand Image <span>— home page "Our Story" section (hidden if none)</span>
                  </div>
                  <div class="image-actions">
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="storyInput.click()"
                      [disabled]="uploadingSlot() === 'story'"
                    >
                      <mat-icon>upload</mat-icon>
                      {{ uploadingSlot() === 'story' ? 'Uploading…' : 'Upload' }}
                    </button>
                    @if (brandConfigService.brand().storyUrl) {
                      <button
                        mat-button
                        type="button"
                        (click)="resetImage('story')"
                        [disabled]="uploadingSlot() === 'story'"
                      >
                        Remove
                      </button>
                    }
                    <input
                      #storyInput
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      (change)="onImageSelected('story', $event)"
                    />
                  </div>
                </div>
              </div>

              <p class="cadence-hint">
                Uploads apply immediately (max 5&nbsp;MB; PNG, JPEG, WebP, or GIF). The installed-PWA
                icon comes from a static manifest and still needs a file swap + rebuild to change.
              </p>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card>
          <mat-card-header>
            <mat-card-title>Avatars</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="cadence-hint">
              Preset profile pictures members can choose from. Upload your own set (max 5&nbsp;MB;
              PNG, JPEG, WebP, or GIF). Removing one doesn't affect members who already picked it
              until they choose another.
            </p>
            <div class="avatar-admin-grid">
              @for (avatar of avatars(); track avatar.id) {
                <div class="avatar-admin-tile">
                  <img [src]="avatar.path" [alt]="avatar.label" />
                  <button
                    mat-icon-button
                    class="avatar-delete"
                    type="button"
                    [attr.aria-label]="'Remove ' + avatar.label"
                    (click)="deleteAvatar(avatar)"
                  >
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              } @empty {
                <p class="avatar-empty">
                  No avatars yet — upload some for members to choose from.
                </p>
              }
            </div>
            <button
              mat-stroked-button
              type="button"
              (click)="avatarInput.click()"
              [disabled]="uploadingAvatar()"
            >
              <mat-icon>upload</mat-icon>
              {{ uploadingAvatar() ? 'Uploading…' : 'Add avatar' }}
            </button>
            <input
              #avatarInput
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              (change)="onAvatarSelected($event)"
            />
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

        <mat-card>
          <mat-card-header>
            <mat-card-title>Home Page</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="form">
              <mat-slide-toggle formControlName="showStats" color="primary">
                Show the stats bar (members / {{ brandConfigService.dinnerPluralLower() }} /
                {{ brandConfigService.locationPluralLower() }})
              </mat-slide-toggle>
            </form>
            <p class="cadence-hint">
              Turn off to hide the counts strip on the home page. Edit the hero text and "Our
              Story" copy under <strong>Admin → Content &amp; Legal</strong>.
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card>
          <mat-card-header>
            <mat-card-title>Terminology</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="cadence-hint terms-intro">
              Rename the core concepts to fit your group. Enter the words as they should appear in
              headings and buttons — they're lowercased automatically where they appear mid-sentence.
            </p>
            <form [formGroup]="form">
              <div class="term-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Venue (singular)</mat-label>
                  <input matInput formControlName="termLocationSingular" placeholder="Location" />
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Venue (plural)</mat-label>
                  <input matInput formControlName="termLocationPlural" placeholder="Locations" />
                </mat-form-field>
              </div>
              <div class="term-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Gathering (singular)</mat-label>
                  <input matInput formControlName="termDinnerSingular" placeholder="Event" />
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Gathering (plural)</mat-label>
                  <input matInput formControlName="termDinnerPlural" placeholder="Events" />
                </mat-form-field>
              </div>
              <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
                <mat-label>Points label</mat-label>
                <input matInput formControlName="termPoints" placeholder="Points" />
                <mat-hint>Appears as "{{ form.controls.termPoints.value }} Leaderboard", etc.</mat-hint>
              </mat-form-field>
            </form>
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
      .avatar-admin-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 8px 0 16px;
      }
      .avatar-admin-tile {
        position: relative;
        width: 64px;
        height: 64px;
        img {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #ddd;
        }
      }
      .avatar-admin-tile .avatar-delete {
        position: absolute;
        top: -8px;
        right: -8px;
        width: 24px;
        height: 24px;
        line-height: 24px;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 50%;
        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          line-height: 16px;
        }
      }
      .avatar-empty {
        color: var(--db-brown-mid);
        font-size: 0.9rem;
        margin: 4px 0;
      }
      .no-image-hint {
        color: #999;
        font-size: 0.8rem;
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
      .terms-intro {
        margin: 0 0 14px;
      }
      .term-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        mat-form-field {
          flex: 1;
          min-width: 160px;
        }
      }
      .brand-images {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }
      .images-title {
        margin: 0 0 12px;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .image-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 0;
        &:not(:last-of-type) {
          border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }
      }
      .image-preview {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background:
          repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px;
        border: 1px solid #ddd;
        border-radius: 6px;
        overflow: hidden;
        img {
          display: block;
          object-fit: contain;
        }
      }
      .logo-preview {
        width: 120px;
        height: 48px;
        img {
          max-width: 112px;
          max-height: 40px;
        }
      }
      .splash-preview {
        width: 120px;
        height: 68px;
        img {
          max-width: 100%;
          max-height: 100%;
        }
      }
      .icon-preview {
        width: 56px;
        height: 56px;
        img {
          max-width: 48px;
          max-height: 48px;
        }
      }
      .image-controls {
        flex: 1;
        min-width: 0;
      }
      .image-label {
        font-weight: 500;
        color: var(--db-text-dark);
        margin-bottom: 6px;
        span {
          font-weight: 400;
          color: #999;
          font-size: 0.82rem;
        }
      }
      .image-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
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
  readonly brandConfigService = inject(BrandConfigService);
  private readonly avatarsService = inject(AvatarsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly uploadingSlot = signal<BrandImageSlot | null>(null);
  readonly avatars = signal<Avatar[]>([]);
  readonly uploadingAvatar = signal(false);
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
    showStats: this.fb.control(true),
    termLocationSingular: this.fb.control('Location', [Validators.required]),
    termLocationPlural: this.fb.control('Locations', [Validators.required]),
    termDinnerSingular: this.fb.control('Event', [Validators.required]),
    termDinnerPlural: this.fb.control('Events', [Validators.required]),
    termPoints: this.fb.control('Points', [Validators.required]),
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
          showStats: byKey.get('home_show_stats') !== 'false',
          termLocationSingular: byKey.get('term_location_singular') || 'Location',
          termLocationPlural: byKey.get('term_location_plural') || 'Locations',
          termDinnerSingular: byKey.get('term_dinner_singular') || 'Event',
          termDinnerPlural: byKey.get('term_dinner_plural') || 'Events',
          termPoints: byKey.get('term_points') || 'Points',
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.loadAvatars();
  }

  private loadAvatars(): void {
    this.avatarsService.listAdmin().subscribe({
      next: (list) => this.avatars.set(list),
      error: () => {},
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

  onImageSelected(slot: BrandImageSlot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingSlot.set(slot);
    // The logo sits on the dark nav/footer, so strip a solid background box to
    // transparent before uploading (no-op fallback if it can't be processed).
    // Other slots (splash/icon/story) render on light surfaces — upload as-is.
    const prepared: Promise<File> =
      slot === 'logo' ? stripLogoBackground(file) : Promise.resolve(file);
    void prepared.then((uploadFile) => {
      this.appConfigService.uploadBrandImage(slot, uploadFile).subscribe({
        next: () => {
          input.value = ''; // let the same file be re-selected later
          // Re-fetch /config/branding so the preview and the whole running app
          // pick up the new image without a reload.
          void this.brandConfigService.refresh().finally(() => this.uploadingSlot.set(null));
          this.snackBar.open('Image updated', 'OK', { duration: 3000 });
        },
        error: () => {
          this.uploadingSlot.set(null);
          this.snackBar.open('Failed to upload image', 'OK', { duration: 4000 });
        },
      });
    });
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Default the label to the filename (sans extension); admins can't rename
    // in-UI yet, so a sensible auto-label keeps the picker tooltips meaningful.
    const label = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Avatar';
    this.uploadingAvatar.set(true);
    this.avatarsService.upload(file, label).subscribe({
      next: (avatar) => {
        input.value = '';
        this.avatars.update((list) => [...list, avatar]);
        this.uploadingAvatar.set(false);
        this.snackBar.open('Avatar added', 'OK', { duration: 3000 });
      },
      error: () => {
        this.uploadingAvatar.set(false);
        this.snackBar.open('Failed to add avatar', 'OK', { duration: 4000 });
      },
    });
  }

  deleteAvatar(avatar: Avatar): void {
    this.avatarsService.remove(avatar.id).subscribe({
      next: () => {
        this.avatars.update((list) => list.filter((a) => a.id !== avatar.id));
        this.snackBar.open('Avatar removed', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to remove avatar', 'OK', { duration: 4000 }),
    });
  }

  resetImage(slot: BrandImageSlot): void {
    this.uploadingSlot.set(slot);
    this.appConfigService.resetBrandImage(slot).subscribe({
      next: () => {
        void this.brandConfigService.refresh().finally(() => this.uploadingSlot.set(null));
        this.snackBar.open('Reverted to default', 'OK', { duration: 3000 });
      },
      error: () => {
        this.uploadingSlot.set(null);
        this.snackBar.open('Failed to reset image', 'OK', { duration: 4000 });
      },
    });
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
      this.appConfigService.updateValue('home_show_stats', val.showStats ? 'true' : 'false'),
      this.appConfigService.updateValue('term_location_singular', val.termLocationSingular.trim()),
      this.appConfigService.updateValue('term_location_plural', val.termLocationPlural.trim()),
      this.appConfigService.updateValue('term_dinner_singular', val.termDinnerSingular.trim()),
      this.appConfigService.updateValue('term_dinner_plural', val.termDinnerPlural.trim()),
      this.appConfigService.updateValue('term_points', val.termPoints.trim()),
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
