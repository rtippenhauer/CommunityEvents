import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  Location,
  LocationsService,
  PlaceSearchResult,
} from '../../../core/services/locations.service';
import { AuthService } from '../../../core/services/auth.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { isElevatedRole } from '../../../core/utils/roles.util';

export interface LocationFormDialogData {
  location?: Location;
}

interface City {
  id: number;
  name: string;
}

@Component({
  selector: 'app-location-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>
      @if (savedLocation()) {
        {{ brand.locationSingular() }} Added
      } @else {
        {{ data.location ? 'Edit' : 'Add' }} {{ brand.locationSingular() }}
      }
    </h2>

    <mat-dialog-content>
      @if (savedLocation(); as r) {
        <!-- ── Read-only saved view ── -->
        <div class="saved-view">
          @if (r.photos?.length) {
            <img class="saved-photo" [src]="r.photos[0].filePath" [alt]="r.name" />
          }
          <div class="saved-name">{{ r.name }}</div>
          <div class="saved-address"><mat-icon>location_on</mat-icon> {{ r.address }}</div>
          @if (r.description) {
            <p class="saved-desc">{{ r.description }}</p>
          }
          <div class="saved-meta-row">
            @if (r.phone) {
              <span class="saved-meta"><mat-icon>phone</mat-icon> {{ r.phone }}</span>
            }
            @if (r.websiteUrl) {
              <a class="saved-meta saved-link" [href]="r.websiteUrl" target="_blank" rel="noopener">
                <mat-icon>language</mat-icon> Website
              </a>
            }
          </div>
          @if (!r.description && !r.phone && !r.websiteUrl) {
            <p class="saved-no-enrich">
              Enrichment found no additional data — you can add details manually from the
              {{ ' ' + brand.locationSingularLower() }} page.
            </p>
          }
        </div>
      } @else if (enriching()) {
        <!-- ── Enriching spinner ── -->
        <div class="enriching-state">
          <mat-spinner diameter="36" />
          <p>Saving & enriching with Google Places…</p>
        </div>
      } @else {
        <!-- ── Edit form ── -->
        <form [formGroup]="form" class="location-form">
          <div class="name-field-wrap">
            <mat-form-field appearance="outline" class="name-field">
              <mat-label>Name</mat-label>
              <input
                matInput
                formControlName="name"
                class="name-input"
                (keydown.enter)="$event.preventDefault(); searchPlaces()"
              />
              <button
                mat-icon-button
                matSuffix
                type="button"
                matTooltip="Look up on Google Places"
                [disabled]="searching()"
                (click)="searchPlaces()"
              >
                @if (searching()) {
                  <mat-spinner diameter="18" />
                } @else {
                  <mat-icon>search</mat-icon>
                }
              </button>
              <mat-error>Name is required</mat-error>
            </mat-form-field>
            @if (placeResults().length) {
              <div class="place-results">
                @for (r of placeResults(); track r.placeId) {
                  <button type="button" class="place-result-row" (click)="pickPlace(r)">
                    <span class="place-result-name">{{ r.name }}</span>
                    <span class="place-result-addr">{{ r.address }}</span>
                  </button>
                }
                <button type="button" class="place-results-clear" (click)="placeResults.set([])">
                  <mat-icon>close</mat-icon> Clear results
                </button>
              </div>
            }
          </div>

          <mat-form-field appearance="outline">
            <mat-label>Address</mat-label>
            <input matInput formControlName="address" />
            <mat-hint>Full street address — used for geocoding</mat-hint>
            <mat-error>Address is required</mat-error>
          </mat-form-field>

          <mat-slide-toggle formControlName="isPrivate" class="private-toggle">
            Private location
          </mat-slide-toggle>
          <p class="private-hint">
            Hides the address from members until they RSVP "Going" to an event here. Unauthenticated
            visitors never see it.
          </p>

          <mat-slide-toggle formControlName="isResidence" class="private-toggle">
            Residence
          </mat-slide-toggle>
          <p class="private-hint">
            A private home, not a business. Enrichment won't look it up as a business — it only
            pulls a Street View photo and leaves the address as entered. Name it however you like
            (e.g. "Rob &amp; Terry's").
          </p>

          @if (cities.length > 1) {
            <mat-form-field appearance="outline">
              <mat-label>City</mat-label>
              <mat-select formControlName="cityId">
                @for (city of cities; track city.id) {
                  <mat-option [value]="city.id">{{ city.name }}</mat-option>
                }
              </mat-select>
              <mat-error>City is required</mat-error>
            </mat-form-field>
          }

          <mat-form-field appearance="outline">
            <mat-label>Phone</mat-label>
            <input matInput formControlName="phone" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Website URL</mat-label>
            <input matInput formControlName="websiteUrl" placeholder="https://..." />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Description</mat-label>
            <textarea matInput formControlName="description" rows="4"></textarea>
          </mat-form-field>

          @if (isAdminOrMod()) {
            <mat-divider style="margin: 8px 0" />
            <div class="mod-section-label">Moderator Info</div>

            <mat-form-field appearance="outline">
              <mat-label>Moderator Notes</mat-label>
              <textarea
                matInput
                formControlName="moderatorNotes"
                rows="3"
                placeholder="Private notes about this venue (visible to mods/admins only)"
              ></textarea>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Contact Name</mat-label>
              <input matInput formControlName="contactName" />
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Contact Phone</mat-label>
              <input matInput formControlName="contactPhone" />
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Contact Email</mat-label>
              <input matInput formControlName="contactEmail" type="email" />
            </mat-form-field>
          }
        </form>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (savedLocation(); as r) {
        <button mat-button (click)="close()">Close</button>
        <button mat-raised-button color="primary" (click)="viewLocation(r.id)">
          <mat-icon>open_in_new</mat-icon> View {{ brand.locationSingular() }}
        </button>
      } @else if (enriching()) {
        <!-- no actions while enriching -->
      } @else {
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          mat-raised-button
          color="primary"
          (click)="save()"
          [disabled]="form.invalid || saving"
        >
          @if (saving) {
            <mat-spinner diameter="20" />
          } @else {
            Save
          }
        </button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .location-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        padding-top: 8px;
      }
      mat-form-field {
        width: 100%;
      }
      .name-field {
        width: 100%;
      }
      .name-input {
        font-size: 1.05rem;
      }
      .mod-section-label {
        font-size: 0.72rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #9c27b0;
        margin: 4px 0;
      }
      .private-toggle {
        margin: 4px 0 0;
      }
      .private-hint {
        margin: 2px 0 8px;
        font-size: 0.78rem;
        color: #888;
      }

      /* ── Place search results ── */
      .name-field-wrap {
        position: relative;
      }
      .place-results {
        position: absolute;
        top: calc(100% - 20px);
        left: 0;
        right: 0;
        background: #fff;
        border: 1px solid #e0d8cc;
        border-radius: 0 0 8px 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
        z-index: 10;
        overflow: hidden;
      }
      .place-result-row {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        padding: 8px 14px;
        border: none;
        border-bottom: 1px solid #f0ebe3;
        background: transparent;
        cursor: pointer;
        text-align: left;
        &:hover {
          background: #faf7f2;
        }
      }
      .place-result-name {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .place-result-addr {
        font-size: 0.78rem;
        color: #888;
        margin-top: 1px;
      }
      .place-results-clear {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        padding: 6px 14px;
        border: none;
        background: #f5f5f5;
        font-size: 0.78rem;
        color: #999;
        cursor: pointer;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
        }
        &:hover {
          color: #666;
        }
      }

      /* ── Enriching spinner ── */
      .enriching-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 40px 20px;
        width: 100%;
        p {
          color: #888;
          font-size: 0.9rem;
          margin: 0;
        }
      }

      /* ── Saved read-only view ── */
      .saved-view {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 4px;
      }
      .saved-photo {
        width: 100%;
        height: 200px;
        object-fit: cover;
        border-radius: 8px;
        margin-bottom: 4px;
      }
      .saved-name {
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--db-brown-dark);
      }
      .saved-address {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.9rem;
        color: #666;
        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          color: #999;
          flex-shrink: 0;
        }
      }
      .saved-desc {
        font-size: 0.9rem;
        color: #444;
        line-height: 1.6;
        margin: 0;
      }
      .saved-meta-row {
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
      }
      .saved-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.88rem;
        color: #555;
        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
        }
      }
      .saved-link {
        color: var(--db-primary);
        text-decoration: none;
        &:hover {
          text-decoration: underline;
        }
      }
      .saved-no-enrich {
        font-size: 0.82rem;
        color: #aaa;
        font-style: italic;
        margin: 0;
      }
    `,
  ],
})
export class LocationFormDialogComponent implements OnInit {
  readonly data = inject<LocationFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LocationFormDialogComponent>);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly http = inject(HttpClient);
  private readonly locationsService = inject(LocationsService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  readonly brand = inject(BrandConfigService);

  cities: City[] = [];
  saving = false;
  readonly searching = signal(false);
  readonly enriching = signal(false);
  readonly placeResults = signal<PlaceSearchResult[]>([]);
  readonly savedLocation = signal<Location | null>(null);
  private placeSelected = false;

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    address: ['', [Validators.required, Validators.maxLength(500)]],
    isPrivate: [false],
    isResidence: [false],
    cityId: [0, [Validators.required, Validators.min(1)]],
    phone: [''],
    websiteUrl: [''],
    description: [''],
    moderatorNotes: [''],
    contactName: [''],
    contactPhone: [''],
    contactEmail: [''],
  });

  isAdminOrMod(): boolean {
    const role = this.authService.currentUser()?.role;
    return isElevatedRole(role);
  }

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => {
      this.cities = cities;
      // Single-region fork: the city selector is hidden (see template), so
      // auto-select the sole city for new locations. Edit mode patches cityId
      // synchronously below before this async callback resolves.
      if (cities.length === 1 && !this.form.controls.cityId.value) {
        this.form.controls.cityId.setValue(cities[0].id);
      }
    });
    if (this.data.location) {
      const r = this.data.location;
      this.form.patchValue({
        name: r.name,
        address: r.address ?? '',
        isPrivate: r.isPrivate,
        isResidence: r.isResidence,
        cityId: r.cityId,
        phone: r.phone ?? '',
        websiteUrl: r.websiteUrl ?? '',
        description: r.description ?? '',
        moderatorNotes: r.moderatorNotes ?? '',
        contactName: r.contactName ?? '',
        contactPhone: r.contactPhone ?? '',
        contactEmail: r.contactEmail ?? '',
      });
    }
  }

  searchPlaces(): void {
    const q = this.form.getRawValue().name.trim();
    if (!q) return;
    this.searching.set(true);
    this.placeResults.set([]);
    this.locationsService.placeSearch(q).subscribe({
      next: (results) => {
        this.searching.set(false);
        this.placeResults.set(results);
        if (!results.length) this.snackBar.open('No results found', 'OK', { duration: 3000 });
      },
      error: () => {
        this.searching.set(false);
        this.snackBar.open('Place search failed', 'OK', { duration: 3000 });
      },
    });
  }

  pickPlace(r: PlaceSearchResult): void {
    this.form.patchValue({ name: r.name, address: r.address });
    this.placeResults.set([]);
    this.placeSelected = true;
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving = true;
    const val = this.form.getRawValue();
    const modFields = this.isAdminOrMod()
      ? {
          moderatorNotes: val.moderatorNotes.trim() || null,
          contactName: val.contactName.trim() || null,
          contactPhone: val.contactPhone.trim() || null,
          contactEmail: val.contactEmail.trim() || null,
        }
      : {};
    const payload = {
      name: val.name,
      address: val.address,
      isPrivate: val.isPrivate,
      isResidence: val.isResidence,
      cityId: val.cityId,
      phone: val.phone.trim() || null,
      websiteUrl: val.websiteUrl.trim() || null,
      description: val.description.trim() || null,
      ...modFields,
    };

    const req$ = this.data.location
      ? this.locationsService.update(this.data.location.id, payload)
      : this.locationsService.create(payload);

    req$.subscribe({
      next: (location) => {
        this.saving = false;
        if (this.placeSelected && !this.data.location) {
          // Auto-enrich then show read-only view
          this.enriching.set(true);
          this.locationsService.enrich(location.id).subscribe({
            next: (result) => {
              this.enriching.set(false);
              this.savedLocation.set(result.location);
            },
            error: () => {
              this.enriching.set(false);
              this.savedLocation.set(location);
            },
          });
        } else {
          this.dialogRef.close(location);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        const msg = err?.error?.message ?? 'Save failed';
        this.snackBar.open(typeof msg === 'string' ? msg : JSON.stringify(msg), 'OK', {
          duration: 5000,
        });
      },
    });
  }

  viewLocation(id: number): void {
    void this.router.navigate(['/locations', id]);
    this.dialogRef.close(this.savedLocation());
  }

  close(): void {
    this.dialogRef.close(this.savedLocation());
  }
}
