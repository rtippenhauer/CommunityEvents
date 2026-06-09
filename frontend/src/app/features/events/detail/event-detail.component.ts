import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormArray, FormControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventsService, Event, GuestLink, Rsvp } from '../../../core/services/events.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventFormDialogComponent } from '../form/event-form-dialog.component';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    DatePipe,
    TitleCasePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
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

          <!-- RSVP section (published events only) -->
          @if (event()!.status === 'published') {
            <mat-card class="rsvp-card">
              <mat-card-content>
                <div class="rsvp-header">
                  <h3>Who's coming</h3>
                  <span class="seat-count">{{ totalSeats() }} seat{{ totalSeats() === 1 ? '' : 's' }} needed</span>
                </div>

                <!-- RSVP action for logged-in members -->
                @if (isLoggedIn()) {
                  <div class="rsvp-action">
                    @if (myRsvp()) {
                      <div class="rsvp-controls">
                        <mat-icon class="going-icon">check_circle</mat-icon>
                        <span class="going-label">You're going!</span>
                        <mat-select [formControl]="guestsCtrl" class="guests-select" (selectionChange)="updateGuests($event.value)">
                          @for (n of guestOptions; track n) {
                            <mat-option [value]="n">+{{ n }} guest{{ n === 1 ? '' : 's' }}</mat-option>
                          }
                        </mat-select>
                        <button mat-stroked-button color="warn" class="cancel-rsvp-btn" (click)="removeRsvp()" [disabled]="rsvpLoading()">
                          Can't make it
                        </button>
                      </div>

                      <!-- Guest panel -->
                      @if (myRsvp()!.additionalGuests > 0) {
                        <div class="guest-panel">
                          <div class="guest-panel-header">
                            <mat-icon class="guest-panel-icon">group_add</mat-icon>
                            <span class="guest-panel-title">Your Guests</span>
                          </div>

                          <!-- Name inputs -->
                          <div class="guest-name-list" [formGroup]="guestNamesForm">
                            @for (ctrl of guestNameControls; track $index) {
                              <div class="guest-name-row">
                                <span class="guest-slot-num">{{ $index + 1 }}</span>
                                <mat-form-field appearance="outline" class="guest-name-field">
                                  <mat-label>Guest {{ $index + 1 }} name (optional)</mat-label>
                                  <input matInput [formControl]="ctrl" maxlength="200" />
                                </mat-form-field>
                                <button
                                  mat-icon-button
                                  class="copy-link-btn"
                                  [matTooltip]="guestLinkTooltip($index)"
                                  [disabled]="generatingLinkIndex() === $index"
                                  (click)="generateAndCopyLink($index)"
                                >
                                  @if (generatingLinkIndex() === $index) {
                                    <mat-spinner diameter="18" />
                                  } @else if (guestLinkAt(myRsvp()!, $index)?.usedAt) {
                                    <mat-icon class="link-used-icon">how_to_reg</mat-icon>
                                  } @else if (guestLinkAt(myRsvp()!, $index)) {
                                    <mat-icon class="link-ready-icon">content_copy</mat-icon>
                                  } @else {
                                    <mat-icon>link</mat-icon>
                                  }
                                </button>
                              </div>
                            }
                          </div>

                          <!-- Generated links status -->
                          @if (myRsvp()!.guestLinks.length > 0) {
                            <div class="link-status-list">
                              @for (link of myRsvp()!.guestLinks; track link.id) {
                                <div class="link-status-row">
                                  <mat-icon class="link-status-icon" [class.used]="link.usedAt">
                                    {{ link.usedAt ? 'check_circle' : 'link' }}
                                  </mat-icon>
                                  <span class="link-status-name">{{ link.recipientName || 'Guest ' + ($index + 1) }}</span>
                                  <span class="link-status-badge" [class.used]="link.usedAt">
                                    {{ link.usedAt ? 'RSVP\'d' : 'Link sent' }}
                                  </span>
                                  @if (!link.usedAt) {
                                    <button mat-icon-button matTooltip="Copy link again" (click)="copyExistingLink(link.token)">
                                      <mat-icon>content_copy</mat-icon>
                                    </button>
                                  }
                                </div>
                              }
                            </div>
                          }

                          <div class="guest-panel-actions">
                            <button
                              mat-stroked-button
                              class="save-names-btn"
                              [disabled]="savingNames()"
                              (click)="saveGuestNames()"
                            >
                              @if (savingNames()) { <mat-spinner diameter="16" /> }
                              Save names
                            </button>
                          </div>
                        </div>
                      }
                    } @else {
                      <button mat-raised-button color="primary" (click)="addRsvp()" [disabled]="rsvpLoading()">
                        <mat-icon>how_to_reg</mat-icon> RSVP
                      </button>
                    }
                  </div>
                } @else {
                  <div class="rsvp-guest-cta">
                    <a mat-stroked-button routerLink="/login">Sign in to RSVP</a>
                  </div>
                }

                <mat-divider class="rsvp-divider" />

                <!-- Attendee list -->
                @if (event()!.rsvps.length === 0) {
                  <p class="no-rsvps">No RSVPs yet — be the first!</p>
                } @else {
                  <ul class="attendee-list">
                    @for (r of event()!.rsvps; track r.id) {
                      <li class="attendee-row">
                        <div class="attendee-avatar">
                          @if (r.user.profilePhotoPath) {
                            <img [src]="r.user.profilePhotoPath" [alt]="r.user.fullName" />
                          } @else {
                            <span class="avatar-initials">{{ initials(r.user.fullName) }}</span>
                          }
                        </div>
                        <div class="attendee-info">
                          <span class="attendee-name">{{ r.user.fullName }}</span>
                          @if (r.additionalGuests > 0) {
                            <span class="attendee-guests">
                              +{{ r.additionalGuests }}
                              @if (namedGuests(r.guestNames)) {
                                <span class="guest-names-inline">({{ namedGuests(r.guestNames) }})</span>
                              }
                            </span>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                }
              </mat-card-content>
            </mat-card>
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
                @if (isAdmin()) {
                  <button mat-stroked-button color="warn" (click)="deleteEvent()">
                    <mat-icon>delete</mat-icon> Delete
                  </button>
                }
              }
              @if (event()!.status === 'published') {
                <button mat-stroked-button color="warn" (click)="cancel()">
                  <mat-icon>cancel</mat-icon> Cancel Event
                </button>
              }
              @if (event()!.status === 'cancelled') {
                <button mat-stroked-button color="primary" (click)="restore()">
                  <mat-icon>undo</mat-icon> Restore to Draft
                </button>
                @if (isAdmin()) {
                  <button mat-stroked-button color="warn" (click)="deleteEvent()">
                    <mat-icon>delete</mat-icon> Delete
                  </button>
                }
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
    .rsvp-card { margin-bottom: 24px; }
    .rsvp-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 16px;
      h3 { margin: 0; color: var(--db-brown-dark); }
    }
    .seat-count {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--db-primary);
    }
    .rsvp-action { margin-bottom: 16px; }
    .rsvp-guest-cta { margin-bottom: 16px; }
    .rsvp-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .going-icon { color: #2e7d32; font-size: 1.4rem; width: 1.4rem; height: 1.4rem; }
    .going-label { font-weight: 600; color: #2e7d32; }
    .guests-select { width: 130px; }
    .cancel-rsvp-btn { font-size: 0.8rem; }

    // ── Guest panel ───────────────────────────────────────────────────────────

    .guest-panel {
      margin-top: 16px;
      padding: 16px;
      background: #faf7f2;
      border: 1px solid #e8e0d6;
      border-radius: 10px;
    }

    .guest-panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }

    .guest-panel-icon { color: var(--db-amber); font-size: 1.2rem; width: 1.2rem; height: 1.2rem; }

    .guest-panel-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--db-brown-dark);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .guest-name-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }

    .guest-name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .guest-slot-num {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--db-amber);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .guest-name-field {
      flex: 1;
      font-size: 0.88rem;
      .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    .copy-link-btn {
      flex-shrink: 0;
      color: var(--db-amber) !important;
    }

    .link-ready-icon { color: #2e7d32 !important; }
    .link-used-icon { color: #999 !important; }

    .link-status-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
      padding: 10px 12px;
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e8e0d6;
    }

    .link-status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
    }

    .link-status-icon {
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      color: var(--db-amber);
      &.used { color: #2e7d32; }
    }

    .link-status-name { flex: 1; color: var(--db-brown-dark); }

    .link-status-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      background: #fff3e0;
      color: var(--db-amber-dark);
      &.used { background: #e8f5e9; color: #2e7d32; }
    }

    .guest-panel-actions { display: flex; justify-content: flex-end; }

    .save-names-btn {
      font-size: 0.8rem;
      height: 32px;
      line-height: 30px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    // ── Attendee list ─────────────────────────────────────────────────────────

    .rsvp-divider { margin: 16px 0; }
    .no-rsvps { color: #999; font-size: 0.9rem; margin: 0; }
    .attendee-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .attendee-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .attendee-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      overflow: hidden;
      flex-shrink: 0;
      background: var(--db-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .avatar-initials { color: #fff; font-size: 0.8rem; font-weight: 700; }
    .attendee-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .attendee-name { font-size: 0.95rem; color: var(--db-brown-dark); }
    .attendee-guests {
      font-size: 0.8rem;
      color: #888;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .guest-names-inline { color: #666; font-style: italic; }

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
  private readonly clipboard = inject(Clipboard);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly event = signal<Event | null>(null);
  readonly loading = signal(true);
  readonly rsvpLoading = signal(false);
  readonly savingNames = signal(false);
  readonly generatingLinkIndex = signal<number | null>(null);

  readonly guestOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  readonly guestsCtrl = new FormControl<number>(0, { nonNullable: true });

  readonly guestNamesForm = this.fb.group({ names: this.fb.array<string>([]) });

  get guestNameControls(): FormControl<string>[] {
    return (this.guestNamesForm.get('names') as FormArray<FormControl<string>>).controls;
  }

  readonly myRsvp = computed<Rsvp | null>(() => {
    const e = this.event();
    const me = this.authService.currentUser();
    if (!e || !me) return null;
    return e.rsvps.find((r) => r.userId === me.id) ?? null;
  });

  readonly totalSeats = computed<number>(() => {
    return (this.event()?.rsvps ?? []).reduce((sum, r) => sum + 1 + r.additionalGuests, 0);
  });

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.eventsService.getOne(id).subscribe({
      next: (e) => {
        this.event.set(e);
        this.loading.set(false);
        const my = e.rsvps.find((r) => r.userId === this.authService.currentUser()?.id);
        if (my) {
          this.guestsCtrl.setValue(my.additionalGuests);
          this.rebuildNameControls(my.additionalGuests, my.guestNames);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private rebuildNameControls(count: number, existing: string[] | null): void {
    const arr = this.guestNamesForm.get('names') as FormArray<FormControl<string>>;
    arr.clear();
    for (let i = 0; i < count; i++) {
      arr.push(this.fb.control(existing?.[i] ?? ''));
    }
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

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  initials(name: string): string {
    return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  namedGuests(names: string[] | null): string {
    if (!names) return '';
    return names.filter((n) => n.trim()).join(', ');
  }

  guestLinkAt(rsvp: Rsvp, index: number): GuestLink | undefined {
    return rsvp.guestLinks[index] as GuestLink | undefined;
  }

  guestLinkTooltip(index: number): string {
    const rsvp = this.myRsvp();
    if (!rsvp) return 'Generate guest link';
    const link = rsvp.guestLinks[index];
    if (!link) return 'Generate & copy guest link';
    if (link.usedAt) return 'Guest already RSVP\'d via this link';
    return 'Copy guest link';
  }

  private refreshEvent(id: number): void {
    this.eventsService.getOne(id).subscribe({
      next: (e) => {
        this.event.set(e);
        const my = e.rsvps.find((r) => r.userId === this.authService.currentUser()?.id);
        this.guestsCtrl.setValue(my?.additionalGuests ?? 0);
        this.rebuildNameControls(my?.additionalGuests ?? 0, my?.guestNames ?? null);
        this.rsvpLoading.set(false);
      },
      error: () => this.rsvpLoading.set(false),
    });
  }

  addRsvp(): void {
    const id = this.event()!.id;
    this.rsvpLoading.set(true);
    this.eventsService.rsvp(id, 0).subscribe({
      next: () => {
        this.refreshEvent(id);
        this.snackBar.open("You're going! 🎉", 'OK', { duration: 3000 });
      },
      error: () => { this.rsvpLoading.set(false); this.snackBar.open('RSVP failed', 'OK', { duration: 3000 }); },
    });
  }

  updateGuests(additionalGuests: number): void {
    const id = this.event()!.id;
    const names = this.guestNameControls.map((c) => c.value);
    this.eventsService.rsvp(id, additionalGuests, names).subscribe({
      next: () => this.refreshEvent(id),
      error: () => this.snackBar.open('Failed to update guests', 'OK', { duration: 3000 }),
    });
  }

  removeRsvp(): void {
    const id = this.event()!.id;
    this.rsvpLoading.set(true);
    this.eventsService.unrsvp(id).subscribe({
      next: () => {
        this.refreshEvent(id);
        this.snackBar.open('RSVP removed', 'OK', { duration: 3000 });
      },
      error: () => { this.rsvpLoading.set(false); this.snackBar.open('Failed to remove RSVP', 'OK', { duration: 3000 }); },
    });
  }

  saveGuestNames(): void {
    const id = this.event()!.id;
    const rsvp = this.myRsvp()!;
    const names = this.guestNameControls.map((c) => c.value);
    this.savingNames.set(true);
    this.eventsService.rsvp(id, rsvp.additionalGuests, names).subscribe({
      next: () => {
        this.refreshEvent(id);
        this.savingNames.set(false);
        this.snackBar.open('Guest names saved', 'OK', { duration: 2000 });
      },
      error: () => { this.savingNames.set(false); this.snackBar.open('Failed to save names', 'OK', { duration: 3000 }); },
    });
  }

  generateAndCopyLink(index: number): void {
    const rsvp = this.myRsvp()!;
    const existingLink = rsvp.guestLinks[index];

    if (existingLink && !existingLink.usedAt) {
      this.copyExistingLink(existingLink.token);
      return;
    }
    if (existingLink?.usedAt) {
      this.snackBar.open('This guest has already RSVP\'d via that link', 'OK', { duration: 3000 });
      return;
    }

    const id = this.event()!.id;
    const recipientName = this.guestNameControls[index]?.value || undefined;
    this.generatingLinkIndex.set(index);

    this.eventsService.generateGuestLink(id, recipientName).subscribe({
      next: (link) => {
        this.generatingLinkIndex.set(null);
        const url = `${window.location.origin}/rsvp-guest?token=${link.token}`;
        this.clipboard.copy(url);
        this.snackBar.open('Guest link copied to clipboard!', 'OK', { duration: 3000 });
        this.refreshEvent(id);
      },
      error: (err) => {
        this.generatingLinkIndex.set(null);
        const msg = err?.error?.message ?? 'Failed to generate link';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  copyExistingLink(token: string): void {
    const url = `${window.location.origin}/rsvp-guest?token=${token}`;
    this.clipboard.copy(url);
    this.snackBar.open('Link copied to clipboard!', 'OK', { duration: 2000 });
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

  restore(): void {
    const e = this.event()!;
    this.eventsService.update(e.id, { status: 'draft' }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.snackBar.open('Event restored to draft', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to restore event', 'OK', { duration: 3000 }),
    });
  }

  deleteEvent(): void {
    if (!window.confirm('Permanently delete this event? This cannot be undone.')) return;
    const e = this.event()!;
    this.eventsService.delete(e.id).subscribe({
      next: () => {
        this.snackBar.open('Event deleted', 'OK', { duration: 3000 });
        void this.router.navigate(['/events']);
      },
      error: () => this.snackBar.open('Failed to delete event', 'OK', { duration: 3000 }),
    });
  }

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  goBack(): void {
    void this.router.navigate(['/events']);
  }
}
