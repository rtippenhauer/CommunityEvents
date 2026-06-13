import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormArray, FormControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
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
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventsService, Event, GuestLink, PublicRsvp, Rsvp, RsvpStatus } from '../../../core/services/events.service';
import { AuthService } from '../../../core/services/auth.service';
import { InvitesService, EventInviteLink } from '../../../core/services/invites.service';
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
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
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
            <span>{{ (event()!.eventDate + 'T12:00:00') | date: 'EEEE, MMMM d, y' }} at {{ formatTime(event()!.eventTime) }}</span>
            @if (event()!.status === 'published') {
              <button mat-stroked-button class="cal-add-btn" [matMenuTriggerFor]="calMenu">
                <mat-icon>calendar_add_on</mat-icon> Add to Calendar
              </button>
              <mat-menu #calMenu="matMenu">
                <a mat-menu-item [href]="googleCalendarUrl()" target="_blank" rel="noopener">
                  <mat-icon>event</mat-icon> Google Calendar
                </a>
                <a mat-menu-item [href]="appleCalendarUrl()" target="_blank" rel="noopener">
                  <mat-icon>calendar_today</mat-icon> Apple Calendar
                </a>
                <a mat-menu-item [href]="icsUrl()" download>
                  <mat-icon>download</mat-icon> Download .ics
                </a>
              </mat-menu>
            }
          </div>

          <!-- Restaurant info -->
          <mat-card class="info-card">
            <mat-card-content>
              <div class="info-row">
                <mat-icon>restaurant</mat-icon>
                <div>
                  <div class="info-label">Restaurant</div>
                  @if (event()!.restaurant?.websiteUrl) {
                    <a class="info-value map-link" [href]="event()!.restaurant!.websiteUrl!" target="_blank" rel="noopener">
                      {{ event()!.restaurantName }}
                    </a>
                  } @else {
                    <div class="info-value">{{ event()!.restaurantName }}</div>
                  }
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
                  <div class="rsvp-counts">
                    <span class="seat-count">{{ totalSeats() }} seat{{ totalSeats() === 1 ? '' : 's' }} needed</span>
                    @if (maybeCount() > 0) {
                      <span class="maybe-count">{{ maybeCount() }} maybe</span>
                    }
                  </div>
                </div>

                <!-- Timing & deadline info -->
                <div class="rsvp-disclaimer">
                  <div class="disclaimer-row">
                    <mat-icon class="disc-icon">schedule</mat-icon>
                    <span>RSVP deadline: <strong>{{ cutoffTimeLabel() }}</strong> day-of</span>
                  </div>
                </div>

                <!-- RSVP action for logged-in members -->
                @if (isLoggedIn()) {
                  <div class="rsvp-action">
                    @if (myRsvp()) {
                      <div class="rsvp-controls">
                        <!-- Three-state toggle -->
                        <mat-button-toggle-group
                          [value]="myRsvp()!.status"
                          (change)="onRsvpStatusChange($event.value)"
                          [disabled]="rsvpLoading()"
                          class="rsvp-toggle">
                          <mat-button-toggle value="going" class="toggle-going">
                            <mat-icon>check_circle</mat-icon> Going
                          </mat-button-toggle>
                          <mat-button-toggle value="maybe" class="toggle-maybe">
                            <mat-icon>help_outline</mat-icon> Maybe
                          </mat-button-toggle>
                          <mat-button-toggle value="not_going" class="toggle-not-going">
                            <mat-icon>cancel</mat-icon> Not Going
                          </mat-button-toggle>
                        </mat-button-toggle-group>

                        @if (myRsvp()!.status === 'going') {
                          <mat-select [formControl]="guestsCtrl" class="guests-select" (selectionChange)="updateGuests($event.value)">
                            <mat-option [value]="0">Just me</mat-option>
                            @for (n of guestOptions.slice(1); track n) {
                              <mat-option [value]="n">+{{ n }} guest{{ n === 1 ? '' : 's' }}</mat-option>
                            }
                          </mat-select>
                        }
                      </div>

                      <!-- Guest panel -->
                      @if (myRsvp()!.additionalGuests > 0) {
                        <div class="guest-panel">
                          <div class="guest-panel-header">
                            <mat-icon class="guest-panel-icon">group_add</mat-icon>
                            <span class="guest-panel-title">Your Guests</span>
                          </div>

                          <div class="guest-compact-list">
                            @for (idx of guestIndices; track idx) {
                              <div class="guest-compact-row">
                                <mat-icon class="guest-row-icon"
                                  [class.link-ready-icon]="guestLinkAt(myRsvp()!, idx) && !guestLinkAt(myRsvp()!, idx)?.usedAt && !guestLinkAt(myRsvp()!, idx)?.cancelledAt"
                                  [class.link-used-icon]="guestLinkAt(myRsvp()!, idx)?.usedAt && !guestLinkAt(myRsvp()!, idx)?.cancelledAt"
                                  [class.link-cancelled-icon]="!!guestLinkAt(myRsvp()!, idx)?.cancelledAt">
                                  {{ guestLinkAt(myRsvp()!, idx)?.cancelledAt ? 'person_off' : guestLinkAt(myRsvp()!, idx)?.usedAt ? 'how_to_reg' : guestLinkAt(myRsvp()!, idx) ? 'link' : 'person_outline' }}
                                </mat-icon>
                                <span class="guest-compact-name" [class.unnamed]="!guestNameControls[idx]?.value?.trim()">
                                  {{ guestNameControls[idx]?.value?.trim() || ('Guest ' + (idx + 1)) }}
                                </span>
                                @if (guestLinkAt(myRsvp()!, idx); as link) {
                                  <span class="link-status-badge" [class.used]="link.usedAt && !link.cancelledAt" [class.cancelled]="link.cancelledAt">
                                    {{ link.cancelledAt ? "Can't Make It" : link.usedAt ? 'Confirmed' : 'Pending' }}
                                  </span>
                                }
                                <div class="guest-row-actions">
                                  <button mat-icon-button class="copy-link-btn"
                                    [matTooltip]="guestLinkTooltip(idx)"
                                    [disabled]="generatingLinkIndex() === idx"
                                    (click)="generateAndCopyLink(idx)">
                                    @if (generatingLinkIndex() === idx) {
                                      <mat-spinner diameter="16" />
                                    } @else if (guestLinkAt(myRsvp()!, idx)?.cancelledAt) {
                                      <mat-icon class="link-cancelled-icon">person_off</mat-icon>
                                    } @else if (guestLinkAt(myRsvp()!, idx)?.usedAt) {
                                      <mat-icon class="link-used-icon">how_to_reg</mat-icon>
                                    } @else if (guestLinkAt(myRsvp()!, idx)) {
                                      <mat-icon class="link-ready-icon">content_copy</mat-icon>
                                    } @else {
                                      <mat-icon>link</mat-icon>
                                    }
                                  </button>
                                  <button mat-icon-button class="edit-guest-btn"
                                    matTooltip="Edit guest"
                                    (click)="toggleEditGuest(idx)">
                                    <mat-icon>{{ editingGuestIndex() === idx ? 'close' : 'edit' }}</mat-icon>
                                  </button>
                                  @if (guestLinkAt(myRsvp()!, idx)) {
                                    <button mat-icon-button class="remove-link-btn"
                                      matTooltip="Remove guest"
                                      [disabled]="removingLinkId() === guestLinkAt(myRsvp()!, idx)!.id"
                                      (click)="removeLink(guestLinkAt(myRsvp()!, idx)!.id)">
                                      @if (removingLinkId() === guestLinkAt(myRsvp()!, idx)!.id) {
                                        <mat-spinner diameter="16" />
                                      } @else {
                                        <mat-icon>person_remove</mat-icon>
                                      }
                                    </button>
                                  }
                                </div>
                              </div>

                              @if (editingGuestIndex() === idx) {
                                <div class="guest-edit-expansion">
                                  <mat-form-field appearance="outline" class="guest-name-field">
                                    <mat-label>Name (optional)</mat-label>
                                    <input matInput [formControl]="guestNameControls[idx]" maxlength="200" />
                                  </mat-form-field>
                                  @if (!guestLinkAt(myRsvp()!, idx)) {
                                    <mat-form-field appearance="outline" class="guest-email-field">
                                      <mat-label>Email (optional)</mat-label>
                                      <mat-icon matPrefix>mail_outline</mat-icon>
                                      <input matInput [formControl]="guestEmailControls[idx]" type="email" maxlength="255" />
                                    </mat-form-field>
                                  }
                                  <div class="guest-edit-save-row">
                                    <button mat-icon-button color="primary" matTooltip="Save"
                                      [disabled]="savingNames()"
                                      (click)="saveAndCloseEdit()">
                                      @if (savingNames()) { <mat-spinner diameter="18" /> }
                                      @else { <mat-icon>check</mat-icon> }
                                    </button>
                                  </div>
                                </div>
                              }
                            }
                          </div>
                        </div>
                      }
                    } @else {
                      @if (!isAdminOrMod() && isPastCutoff()) {
                        <div class="cutoff-banner">
                          <mat-icon>lock_clock</mat-icon>
                          <span>RSVP closed — deadline was {{ cutoffTimeLabel() }} today</span>
                        </div>
                      } @else {
                        <div class="rsvp-initial-toggle">
                          <mat-button-toggle-group class="rsvp-toggle" [disabled]="rsvpLoading()">
                            <mat-button-toggle value="going" class="toggle-going" (click)="addRsvp('going')">
                              <mat-icon>check_circle</mat-icon> Going
                            </mat-button-toggle>
                            <mat-button-toggle value="maybe" class="toggle-maybe" (click)="addRsvp('maybe')">
                              <mat-icon>help_outline</mat-icon> Maybe
                            </mat-button-toggle>
                          </mat-button-toggle-group>
                        </div>
                      }
                    }
                  </div>
                } @else {
                  <div class="rsvp-guest-cta">
                    <a mat-stroked-button routerLink="/login">Sign in to RSVP</a>
                    <span class="rsvp-or">or</span>
                    @if (publicRsvpDone()) {
                      <div class="public-rsvp-success">
                        <mat-icon>check_circle</mat-icon>
                        You're on the list! Check your email for your confirmation link.
                      </div>
                    } @else {
                      <div class="public-rsvp-form">
                        <p class="public-rsvp-label">Attending without an account?</p>
                        <div class="public-rsvp-fields">
                          <mat-form-field appearance="outline" class="pub-field">
                            <mat-label>Your name</mat-label>
                            <input matInput [value]="publicRsvpName()" (input)="publicRsvpName.set($any($event.target).value)" maxlength="200" />
                          </mat-form-field>
                          <mat-form-field appearance="outline" class="pub-field">
                            <mat-label>Email address</mat-label>
                            <input matInput type="email" [value]="publicRsvpEmail()" (input)="publicRsvpEmail.set($any($event.target).value)" maxlength="255" />
                          </mat-form-field>
                        </div>
                        @if (publicRsvpError()) {
                          <div class="public-rsvp-error">{{ publicRsvpError() }}</div>
                        }
                        <button mat-stroked-button
                          [disabled]="publicRsvpLoading() || !publicRsvpName().trim() || !publicRsvpEmail().trim()"
                          (click)="submitPublicRsvp()">
                          @if (publicRsvpLoading()) { <mat-spinner diameter="16" /> }
                          I'm going!
                        </button>
                      </div>
                    }
                  </div>
                }

                <mat-divider class="rsvp-divider" />

                <!-- Attendee list -->
                @if (event()!.rsvps.length === 0 && event()!.publicRsvps.length === 0) {
                  <p class="no-rsvps">No RSVPs yet — be the first!</p>
                } @else {
                  <ul class="attendee-list">
                    @for (r of event()!.rsvps; track r.id) {
                      <li class="attendee-row" [class.attendee-maybe]="r.status === 'maybe'">
                        <div class="attendee-avatar">
                          @if (r.user.profilePhotoPath) {
                            <img [src]="r.user.profilePhotoPath" [alt]="r.user.fullName" />
                          } @else {
                            <span class="avatar-initials">{{ initials(r.user.fullName) }}</span>
                          }
                        </div>
                        <div class="attendee-info">
                          <div class="attendee-name-row">
                            <span class="attendee-name">{{ r.user.fullName }}</span>
                            @if (r.status === 'maybe') {
                              <span class="maybe-badge">Maybe</span>
                            }
                          </div>
                          @if (r.additionalGuests > 0 && r.status === 'going') {
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
                    @for (p of event()!.publicRsvps; track p.id) {
                      <li class="attendee-row">
                        <div class="attendee-avatar attendee-avatar-guest">
                          <mat-icon class="guest-avatar-icon">person</mat-icon>
                        </div>
                        <div class="attendee-info">
                          <span class="attendee-name">{{ p.recipientName || 'Guest' }}</span>
                          <span class="attendee-guest-badge">guest</span>
                        </div>
                      </li>
                    }
                  </ul>
                }
              </mat-card-content>
            </mat-card>
          }

          <!-- Sharing (admin/mod only, published events only) -->
          @if (event()!.status === 'published' && isAdminOrMod()) {
            <mat-card class="share-card">
              <mat-card-content>
                <div class="share-section">
                  <h4 class="share-section-title">
                    <mat-icon>share</mat-icon> Share
                  </h4>
                  <div class="share-btn-row">
                    <button mat-stroked-button class="fb-btn" (click)="shareToFacebook()"
                      matTooltip="Opens Facebook share dialog — change destination to your DinnerBears group">
                      <mat-icon>open_in_new</mat-icon> Share on Facebook
                    </button>
                    <button mat-stroked-button (click)="copyPostText()">
                      <mat-icon>content_copy</mat-icon> Copy Post Text
                    </button>
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          }

          <!-- Invite Links (admin/mod, published events) -->
          @if (event()!.status === 'published' && isAdminOrMod()) {
            <mat-card class="invite-links-card">
              <mat-card-content>
                <div class="invite-links-header">
                  <h4 class="invite-links-title">
                    <mat-icon>link</mat-icon> Event Invite Links
                  </h4>
                  @if (isAdmin()) {
                    <button mat-stroked-button class="new-link-btn" (click)="showNewLinkForm.set(!showNewLinkForm())">
                      <mat-icon>add</mat-icon> New Link
                    </button>
                  }
                </div>

                @if (showNewLinkForm()) {
                  <div class="new-link-form">
                    <mat-button-toggle-group [value]="newLinkFlavor()" (change)="newLinkFlavor.set($event.value)" class="flavor-toggle">
                      <mat-button-toggle value="non_validated">Guest Member</mat-button-toggle>
                      <mat-button-toggle value="member">Full Member</mat-button-toggle>
                    </mat-button-toggle-group>
                    <mat-form-field appearance="outline" class="link-field">
                      <mat-label>Max Uses (blank = unlimited)</mat-label>
                      <input matInput type="number" [formControl]="newLinkMaxUsesCtrl" min="1" />
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="link-field">
                      <mat-label>Expires in (days)</mat-label>
                      <input matInput type="number" [formControl]="newLinkExpiryCtrl" min="1" max="90" />
                    </mat-form-field>
                    <button mat-raised-button color="primary" (click)="createInviteLink()" [disabled]="creatingLink()">
                      @if (creatingLink()) { <mat-spinner diameter="16" /> }
                      Generate Link
                    </button>
                  </div>
                }

                @if (inviteLinksLoading()) {
                  <div class="links-spinner"><mat-spinner diameter="24" /></div>
                } @else if (inviteLinks().length === 0) {
                  <p class="no-links">No invite links yet.</p>
                } @else {
                  <div class="invite-links-list">
                    @for (link of inviteLinks(); track link.id) {
                      <div class="invite-link-row" [class.link-revoked]="link.isRevoked">
                        <div class="link-info">
                          <span class="link-flavor-badge" [class.flavor-member]="link.inviteFlavor === 'member'" [class.flavor-nv]="link.inviteFlavor === 'non_validated'">
                            {{ link.inviteFlavor === 'member' ? 'Member' : 'Guest Member' }}
                          </span>
                          <span class="link-uses">{{ link.useCount }}{{ link.maxUses ? '/' + link.maxUses : '' }} uses</span>
                          <span class="link-expiry">exp. {{ link.expiresAt | date: 'MMM d' }}</span>
                          @if (link.isRevoked) {
                            <span class="link-revoked-badge">Revoked</span>
                          }
                        </div>
                        <div class="link-actions">
                          @if (!link.isRevoked) {
                            <button mat-icon-button matTooltip="Copy link" (click)="copyInviteLink(link.token)">
                              <mat-icon>content_copy</mat-icon>
                            </button>
                            @if (isAdmin()) {
                              <button mat-icon-button matTooltip="Revoke" color="warn" (click)="revokeInviteLink(link.id)">
                                <mat-icon>block</mat-icon>
                              </button>
                            }
                          }
                        </div>
                      </div>
                    }
                  </div>
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
    .cal-add-btn {
      height: 28px !important;
      min-height: 28px !important;
      line-height: 26px !important;
      font-size: 0.75rem !important;
      padding: 0 10px !important;
      color: var(--db-primary) !important;
      border-color: var(--db-primary) !important;
      mat-icon { font-size: 0.9rem; width: 0.9rem; height: 0.9rem; margin-right: 2px; }
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
    .rsvp-disclaimer {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      margin-bottom: 14px;
      background: #faf7f2;
      border: 1px solid #e8e0d6;
      border-radius: 8px;
    }
    .disclaimer-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.82rem;
      color: #666;
    }
    .disc-icon {
      font-size: 0.95rem;
      width: 0.95rem;
      height: 0.95rem;
      color: var(--db-amber);
      flex-shrink: 0;
    }
    .cutoff-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #fff3e0;
      border: 1px solid #ffb74d;
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 500;
      color: #e65100;
      mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
    }
    .rsvp-action { margin-bottom: 16px; }
    .rsvp-guest-cta {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rsvp-or {
      font-size: 0.8rem;
      color: #aaa;
      text-align: center;
    }
    .public-rsvp-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .public-rsvp-label {
      margin: 0;
      font-size: 0.82rem;
      color: #666;
      font-weight: 500;
    }
    .public-rsvp-fields {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      .pub-field {
        flex: 1;
        min-width: 140px;
        font-size: 0.88rem;
        .mat-mdc-form-field-subscript-wrapper { display: none; }
      }
    }
    .public-rsvp-error {
      font-size: 0.8rem;
      color: #c62828;
    }
    .public-rsvp-success {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #e8f5e9;
      border-radius: 8px;
      font-size: 0.88rem;
      color: #2e7d32;
      font-weight: 500;
      mat-icon { color: #2e7d32; font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
    }
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
      margin-bottom: 12px;
    }

    .guest-panel-icon { color: var(--db-amber); font-size: 1.2rem; width: 1.2rem; height: 1.2rem; }

    .guest-panel-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--db-brown-dark);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .guest-compact-list { display: flex; flex-direction: column; gap: 4px; }

    .guest-compact-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px 4px 4px;
      border-radius: 6px;
      background: #fff;
      border: 1px solid #e8e0d6;
    }

    .guest-row-icon {
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      flex-shrink: 0;
      color: #bbb;
    }

    .guest-compact-name {
      flex: 1;
      font-size: 0.9rem;
      color: var(--db-brown-dark);
      &.unnamed { color: #aaa; font-style: italic; }
    }

    .guest-row-actions {
      display: flex;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
      .mat-mdc-icon-button { width: 32px; height: 32px; padding: 4px; }
    }

    .copy-link-btn { color: var(--db-amber) !important; }
    .edit-guest-btn { color: #888 !important; }

    .link-ready-icon { color: #2e7d32 !important; }
    .link-used-icon { color: #999 !important; }
    .link-cancelled-icon { color: #c62828 !important; }
    .remove-link-btn { color: #c62828 !important; opacity: 0.7; &:hover { opacity: 1; } }

    .link-status-badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      white-space: nowrap;
      background: #fff3e0;
      color: var(--db-amber-dark);
      &.used { background: #e8f5e9; color: #2e7d32; }
      &.cancelled { background: #ffebee; color: #c62828; }
    }

    .guest-edit-expansion {
      padding: 10px 12px 4px;
      background: #fff;
      border: 1px solid #e8e0d6;
      border-top: none;
      border-radius: 0 0 6px 6px;
      margin-top: -4px;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .guest-name-field, .guest-email-field {
      width: 100%;
      font-size: 0.88rem;
      .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    .guest-edit-save-row { display: flex; justify-content: flex-end; margin-top: -4px; }

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
    .attendee-avatar-guest {
      background: #e8e0d6;
      .guest-avatar-icon { color: #999; font-size: 1.2rem; width: 1.2rem; height: 1.2rem; }
    }
    .attendee-guest-badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      background: #f5edd8;
      color: var(--db-brown-mid);
      align-self: flex-start;
    }

    // ── RSVP toggle ──────────────────────────────────────────────────────────

    .rsvp-counts {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .maybe-count {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--db-amber-dark, #e65100);
      background: #fff3e0;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .rsvp-toggle {
      .mat-button-toggle-button { font-size: 0.85rem; }
      .toggle-going.mat-button-toggle-checked { background: #e8f5e9; color: #2e7d32; }
      .toggle-maybe.mat-button-toggle-checked { background: #fff3e0; color: #e65100; }
      .toggle-not-going.mat-button-toggle-checked { background: #ffebee; color: #c62828; }
      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; vertical-align: middle; margin-right: 4px; }
    }

    .rsvp-initial-toggle { margin-bottom: 4px; }

    .attendee-maybe { opacity: 0.75; }

    .attendee-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .maybe-badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      background: #fff3e0;
      color: #e65100;
    }

    // ── Invite Links panel ────────────────────────────────────────────────────

    .invite-links-card { margin-bottom: 24px; }

    .invite-links-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .invite-links-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--db-brown-dark);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; color: var(--db-amber); }
    }

    .new-link-btn { font-size: 0.8rem; height: 32px !important; }

    .new-link-form {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      padding: 12px;
      background: #faf7f2;
      border-radius: 8px;
      margin-bottom: 16px;

      .link-field {
        width: 180px;
        font-size: 0.88rem;
        .mat-mdc-form-field-subscript-wrapper { display: none; }
      }

      .flavor-toggle .mat-button-toggle-button { font-size: 0.8rem; }
    }

    .links-spinner { display: flex; justify-content: center; padding: 16px; }
    .no-links { color: #999; font-size: 0.88rem; margin: 0; }

    .invite-links-list { display: flex; flex-direction: column; gap: 8px; }

    .invite-link-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border: 1px solid #e8e0d6;
      border-radius: 8px;
      background: #fdfaf5;

      &.link-revoked { opacity: 0.5; }
    }

    .link-info {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.82rem;
      color: #666;
    }

    .link-flavor-badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      &.flavor-member { background: #e3f2fd; color: #1565c0; }
      &.flavor-nv { background: #f3e5f5; color: #6a1b9a; }
    }

    .link-revoked-badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      background: #ffebee;
      color: #c62828;
    }

    .link-actions {
      display: flex;
      align-items: center;
      gap: 0;
      .mat-mdc-icon-button { width: 32px; height: 32px; padding: 4px; }
    }

    // ── Share & Calendar ──────────────────────────────────────────────────────

    .share-card { margin-bottom: 24px; }

    .share-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .share-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--db-brown-dark);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; color: var(--db-amber); }
    }

    .share-btn-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .cal-btn, .fb-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-decoration: none;
      height: 28px !important;
      min-height: 28px !important;
      line-height: 26px !important;
      font-size: 0.78rem !important;
      padding: 0 10px !important;
      mat-icon { font-size: 0.9rem; width: 0.9rem; height: 0.9rem; }
    }

    .share-divider { margin: 16px 0; }

    // ── Admin actions ─────────────────────────────────────────────────────────

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
  private readonly invitesService = inject(InvitesService);
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
  readonly removingLinkId = signal<number | null>(null);
  readonly publicRsvpName = signal('');
  readonly publicRsvpEmail = signal('');
  readonly publicRsvpLoading = signal(false);
  readonly publicRsvpDone = signal(false);
  readonly publicRsvpError = signal<string | null>(null);

  // Invite links state
  readonly inviteLinks = signal<EventInviteLink[]>([]);
  readonly inviteLinksLoading = signal(false);
  readonly showNewLinkForm = signal(false);
  readonly newLinkFlavor = signal<'member' | 'non_validated'>('non_validated');
  readonly newLinkMaxUsesCtrl = new FormControl<number | null>(null);
  readonly newLinkExpiryCtrl = new FormControl<number>(30, { nonNullable: true });
  readonly creatingLink = signal(false);

  readonly editingGuestIndex = signal<number | null>(null);

  readonly guestOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  readonly guestsCtrl = new FormControl<number>(0, { nonNullable: true });

  readonly guestNamesForm = this.fb.group({ names: this.fb.array<string>([]) });
  readonly guestEmailsForm = this.fb.group({ emails: this.fb.array<string>([]) });

  get guestNameControls(): FormControl<string>[] {
    return (this.guestNamesForm.get('names') as FormArray<FormControl<string>>).controls;
  }

  get guestEmailControls(): FormControl<string>[] {
    return (this.guestEmailsForm.get('emails') as FormArray<FormControl<string>>).controls;
  }

  get guestIndices(): number[] {
    return Array.from({ length: this.guestNameControls.length }, (_, i) => i);
  }

  toggleEditGuest(idx: number): void {
    this.editingGuestIndex.set(this.editingGuestIndex() === idx ? null : idx);
  }

  saveAndCloseEdit(): void {
    this.editingGuestIndex.set(null);
    this.saveGuestNames();
  }

  readonly myRsvp = computed<Rsvp | null>(() => {
    const e = this.event();
    const me = this.authService.currentUser();
    if (!e || !me) return null;
    return e.rsvps.find((r) => r.userId === me.id) ?? null;
  });

  readonly totalSeats = computed<number>(() => {
    const e = this.event();
    if (!e) return 0;
    // Only Going RSVPs count toward venue seat numbers
    const memberSeats = e.rsvps
      .filter((r) => r.status === 'going')
      .reduce((sum, r) => {
        const cancelled = (r.guestLinks ?? []).filter((l) => l.cancelledAt).length;
        return sum + 1 + r.additionalGuests - cancelled;
      }, 0);
    const publicSeats = (e.publicRsvps ?? []).length;
    return memberSeats + publicSeats;
  });

  readonly maybeCount = computed<number>(() => {
    const e = this.event();
    if (!e) return 0;
    return e.rsvps.filter((r) => r.status === 'maybe').length;
  });

  readonly isPastCutoff = computed<boolean>(() => {
    const e = this.event();
    if (!e) return false;
    const now = new Date();
    const [y, m, d] = e.eventDate.split('-').map(Number);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventDay = new Date(y, m - 1, d);
    if (today.getTime() !== eventDay.getTime()) return false;
    const [h, min] = e.eventTime.split(':').map(Number);
    const cutoffMinutes = h * 60 + min - 150; // 2.5 hrs before event
    return now.getHours() * 60 + now.getMinutes() >= cutoffMinutes;
  });

  readonly cutoffTimeLabel = computed<string>(() => {
    const e = this.event();
    if (!e) return '';
    const [h, min] = e.eventTime.split(':').map(Number);
    const cm = h * 60 + min - 150;
    const ch = Math.floor(cm / 60);
    const cmin = cm % 60;
    const ampm = ch >= 12 ? 'PM' : 'AM';
    return `${ch % 12 || 12}:${String(cmin).padStart(2, '0')} ${ampm}`;
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
        if (e.status === 'published' && this.isAdminOrMod()) {
          this.loadInviteLinks(id);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private loadInviteLinks(eventId: number): void {
    this.inviteLinksLoading.set(true);
    this.invitesService.getEventInviteLinks(eventId).subscribe({
      next: (links) => {
        this.inviteLinks.set(links);
        this.inviteLinksLoading.set(false);
      },
      error: () => this.inviteLinksLoading.set(false),
    });
  }

  private rebuildNameControls(count: number, existing: string[] | null, preservedEmails?: string[]): void {
    const arr = this.guestNamesForm.get('names') as FormArray<FormControl<string>>;
    arr.clear();
    for (let i = 0; i < count; i++) {
      arr.push(this.fb.control(existing?.[i] ?? ''));
    }
    const emailArr = this.guestEmailsForm.get('emails') as FormArray<FormControl<string>>;
    emailArr.clear();
    for (let i = 0; i < count; i++) {
      emailArr.push(this.fb.control(preservedEmails?.[i] ?? ''));
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

  googleCalendarUrl(): string {
    return this.eventsService.googleCalendarUrl(this.event()!);
  }

  icsUrl(): string {
    return `/api/v1/events/${this.event()!.id}/ics`;
  }

  appleCalendarUrl(): string {
    const ics = `${window.location.origin}/api/v1/events/${this.event()!.id}/ics`;
    return `webcal://${ics.replace(/^https?:\/\//, '')}`;
  }

  shareToFacebook(): void {
    const e = this.event()!;
    const url = `${window.location.origin}/events/${e.id}`;
    const quote = this.eventsService.generatePostText(e);
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(quote)}`,
      '_blank',
      'noopener',
    );
  }

  copyPostText(): void {
    const text = this.eventsService.generatePostText(this.event()!);
    this.clipboard.copy(text);
    this.snackBar.open('Post text copied to clipboard!', 'OK', { duration: 3000 });
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
    return rsvp.guestLinks?.[index];
  }

  guestLinkTooltip(index: number): string {
    const rsvp = this.myRsvp();
    if (!rsvp) return 'Generate guest link';
    const link = rsvp.guestLinks?.[index];
    if (!link) return 'Generate & copy guest link';
    if (link.cancelledAt) return "Guest can't make it";
    if (link.usedAt) return 'Guest confirmed';
    return 'Copy guest link';
  }

  private refreshEvent(id: number, preservedEmails?: string[], expandIndex?: number | null): void {
    this.eventsService.getOne(id).subscribe({
      next: (e) => {
        this.event.set(e);
        const my = e.rsvps.find((r) => r.userId === this.authService.currentUser()?.id);
        this.guestsCtrl.setValue(my?.additionalGuests ?? 0);
        this.rebuildNameControls(my?.additionalGuests ?? 0, my?.guestNames ?? null, preservedEmails);
        this.rsvpLoading.set(false);
        if (expandIndex != null) this.editingGuestIndex.set(expandIndex);
      },
      error: () => this.rsvpLoading.set(false),
    });
  }

  addRsvp(status: RsvpStatus = 'going'): void {
    const id = this.event()!.id;
    this.rsvpLoading.set(true);
    this.eventsService.rsvp(id, status, 0).subscribe({
      next: () => {
        this.refreshEvent(id);
        const msg = status === 'going' ? "You're going! 🎉" : "Marked as Maybe!";
        this.snackBar.open(msg, 'OK', { duration: 3000 });
      },
      error: () => { this.rsvpLoading.set(false); this.snackBar.open('RSVP failed', 'OK', { duration: 3000 }); },
    });
  }

  onRsvpStatusChange(newStatus: RsvpStatus): void {
    if (newStatus === 'not_going') {
      this.removeRsvp();
      return;
    }
    const id = this.event()!.id;
    const rsvp = this.myRsvp()!;
    this.rsvpLoading.set(true);
    this.eventsService.rsvp(id, newStatus, rsvp.additionalGuests, rsvp.guestNames ?? undefined).subscribe({
      next: () => {
        this.refreshEvent(id);
        const msg = newStatus === 'going' ? "Changed to Going!" : "Changed to Maybe!";
        this.snackBar.open(msg, 'OK', { duration: 2000 });
      },
      error: () => { this.rsvpLoading.set(false); this.snackBar.open('Failed to update', 'OK', { duration: 3000 }); },
    });
  }

  updateGuests(additionalGuests: number): void {
    const id = this.event()!.id;
    const oldCount = this.guestNameControls.length;
    const names = this.guestNameControls.map((c) => c.value);
    const emails = this.guestEmailControls.map((c) => c.value);
    const status = this.myRsvp()?.status ?? 'going';
    this.eventsService.rsvp(id, status, additionalGuests, names).subscribe({
      next: () => this.refreshEvent(id, emails, additionalGuests > oldCount ? additionalGuests - 1 : null),
      error: () => this.snackBar.open('Failed to update guests', 'OK', { duration: 3000 }),
    });
  }

  removeRsvp(): void {
    const id = this.event()!.id;
    this.rsvpLoading.set(true);
    this.eventsService.unrsvp(id).subscribe({
      next: () => {
        this.refreshEvent(id);
        this.snackBar.open("RSVP removed", 'OK', { duration: 3000 });
      },
      error: () => { this.rsvpLoading.set(false); this.snackBar.open('Failed to remove RSVP', 'OK', { duration: 3000 }); },
    });
  }

  saveGuestNames(): void {
    const id = this.event()!.id;
    const rsvp = this.myRsvp()!;
    const names = this.guestNameControls.map((c) => c.value);
    const emails = this.guestEmailControls.map((c) => c.value);
    this.savingNames.set(true);
    this.eventsService.rsvp(id, rsvp.status, rsvp.additionalGuests, names).subscribe({
      next: () => {
        // Auto-generate links (and queue invite emails) for guests who have an email but no link yet
        const linkTasks = emails
          .map((email, i) => ({ email: email.trim(), i }))
          .filter(({ email, i }) => email && !this.guestLinkAt(rsvp, i))
          .map(({ email, i }) => this.eventsService.generateGuestLink(id, names[i] || undefined, email));

        if (linkTasks.length === 0) {
          this.refreshEvent(id, emails);
          this.savingNames.set(false);
          this.snackBar.open('Guest names saved', 'OK', { duration: 2000 });
          return;
        }

        forkJoin(linkTasks).subscribe({
          next: () => {
            this.refreshEvent(id, emails);
            this.savingNames.set(false);
            const n = linkTasks.length;
            this.snackBar.open(`Names saved — ${n} invite email${n !== 1 ? 's' : ''} queued`, 'OK', { duration: 3000 });
          },
          error: () => {
            this.refreshEvent(id, emails);
            this.savingNames.set(false);
            this.snackBar.open('Names saved — some invites may have failed to send', 'OK', { duration: 3000 });
          },
        });
      },
      error: () => { this.savingNames.set(false); this.snackBar.open('Failed to save names', 'OK', { duration: 3000 }); },
    });
  }

  generateAndCopyLink(index: number): void {
    const rsvp = this.myRsvp()!;
    const existingLink = rsvp.guestLinks?.[index];

    // Always allow copying an existing link so the member can re-send it
    if (existingLink) {
      const url = `${window.location.origin}/rsvp-guest?token=${existingLink.token}`;
      this.clipboard.copy(url);
      const msg = existingLink.cancelledAt ? "Link copied — guest can re-RSVP with this"
                : existingLink.usedAt ? 'Link copied — guest already confirmed'
                : 'Link copied!';
      this.snackBar.open(msg, 'OK', { duration: 3000 });
      return;
    }

    const id = this.event()!.id;
    const recipientName = this.guestNameControls[index]?.value || undefined;
    const recipientEmail = this.guestEmailControls[index]?.value || undefined;
    this.generatingLinkIndex.set(index);

    this.eventsService.generateGuestLink(id, recipientName, recipientEmail).subscribe({
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

  removeLink(linkId: number): void {
    if (!window.confirm('Remove this guest? Their link will stop working and your guest count will decrease by 1.')) return;
    const id = this.event()!.id;
    this.removingLinkId.set(linkId);
    this.eventsService.removeGuestLink(id, linkId).subscribe({
      next: () => {
        this.removingLinkId.set(null);
        this.refreshEvent(id);
        this.snackBar.open('Guest removed', 'OK', { duration: 2000 });
      },
      error: () => {
        this.removingLinkId.set(null);
        this.snackBar.open('Failed to remove guest', 'OK', { duration: 3000 });
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
      if (updated) {
        this.eventsService.getOne(updated.id).subscribe((fresh) => this.event.set(fresh));
      }
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

  submitPublicRsvp(): void {
    const name = this.publicRsvpName().trim();
    const email = this.publicRsvpEmail().trim();
    if (!name || !email) return;
    this.publicRsvpLoading.set(true);
    this.publicRsvpError.set(null);
    this.eventsService.publicRsvp(this.event()!.id, name, email).subscribe({
      next: () => {
        this.publicRsvpLoading.set(false);
        this.publicRsvpDone.set(true);
      },
      error: (err) => {
        this.publicRsvpLoading.set(false);
        this.publicRsvpError.set(err?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  copyInviteLink(token: string): void {
    const url = `${window.location.origin}/join/${token}`;
    this.clipboard.copy(url);
    this.snackBar.open('Invite link copied!', 'OK', { duration: 2000 });
  }

  createInviteLink(): void {
    const id = this.event()!.id;
    this.creatingLink.set(true);
    this.invitesService.createEventInviteLink(id, {
      flavor: this.newLinkFlavor(),
      maxUses: this.newLinkMaxUsesCtrl.value ?? null,
      expiryDays: this.newLinkExpiryCtrl.value,
    }).subscribe({
      next: (link) => {
        this.inviteLinks.update((links) => [link, ...links]);
        this.showNewLinkForm.set(false);
        this.creatingLink.set(false);
        const url = `${window.location.origin}/join/${link.token}`;
        this.clipboard.copy(url);
        this.snackBar.open('Invite link created and copied!', 'OK', { duration: 3000 });
      },
      error: () => {
        this.creatingLink.set(false);
        this.snackBar.open('Failed to create invite link', 'OK', { duration: 3000 });
      },
    });
  }

  revokeInviteLink(inviteId: number): void {
    if (!window.confirm('Revoke this invite link? Any unactivated links will stop working.')) return;
    const id = this.event()!.id;
    this.invitesService.revokeEventInviteLink(id, inviteId).subscribe({
      next: () => {
        this.inviteLinks.update((links) => links.map((l) => l.id === inviteId ? { ...l, isRevoked: true } : l));
        this.snackBar.open('Invite link revoked', 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Failed to revoke link', 'OK', { duration: 3000 }),
    });
  }

  goBack(): void {
    void this.router.navigate(['/events']);
  }
}
