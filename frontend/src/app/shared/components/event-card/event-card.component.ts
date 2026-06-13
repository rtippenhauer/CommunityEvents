import { Component, Input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Event } from '../../../core/services/events.service';

@Component({
  selector: 'app-event-card',
  standalone: true,
  imports: [DatePipe, RouterLink, MatIconModule],
  template: `
    <a class="event-card" [class.cancelled]="event.status === 'cancelled'" [class.draft]="event.status === 'draft'" [routerLink]="['/events', event.id]">
      <!-- Photo header — keep exactly as-is -->
      <div class="card-photo" [class.compact]="compact">
        @if (event.restaurant?.photos?.length) {
          <img [src]="event.restaurant!.photos[0].filePath" [alt]="event.restaurantName" loading="lazy" />
        } @else {
          <div class="card-photo-placeholder"></div>
        }
        @if (event.status === 'cancelled') {
          <div class="cancelled-overlay">CANCELLED</div>
        }
        @if (event.status === 'draft') {
          <div class="draft-overlay">DRAFT</div>
        }
        <div class="card-photo-fade"></div>
      </div>

      <!-- Card body -->
      <div class="card-body">
        <div class="card-date">
          {{ event.eventDate | date:'EEE, MMM d' }} &middot; {{ formatTime(event.eventTime) }}
        </div>
        @if (!compact) {
          <div class="card-city">{{ event.city.name }}</div>
        }
        <div class="card-restaurant" [class.muted]="event.status === 'cancelled'">
          {{ event.restaurantName }}
        </div>
      </div>

      <!-- Footer -->
      <div class="card-footer">
        @if (event.status === 'cancelled') {
          <span class="cancelled-badge">
            <mat-icon class="cancelled-badge-icon">cancel</mat-icon>
            Event cancelled
          </span>
        } @else {
          <div class="footer-left">
            @if (snippet.length > 0) {
              <div class="avatar-cluster">
                @for (a of snippet; track $index) {
                  <div class="avatar-chip" [style.z-index]="snippet.length - $index">{{ initials(a.fullName) }}</div>
                }
              </div>
            }
            @if (totalAttending > 0) {
              <span class="going-count">{{ totalAttending }} going</span>
            }
          </div>
          <div class="footer-right">
            @if (event.myRsvpStatus === 'going') {
              <span class="rsvp-pill rsvp-pill--done">
                <mat-icon class="rsvp-pill-icon">check_circle</mat-icon>
                Going
              </span>
            } @else if (event.myRsvpStatus === 'maybe') {
              <span class="rsvp-pill rsvp-pill--done">
                <mat-icon class="rsvp-pill-icon">check_circle</mat-icon>
                Maybe
              </span>
            } @else if (!isPast) {
              <span class="rsvp-pill rsvp-pill--cta">RSVP</span>
            }
          </div>
        }
      </div>
    </a>
  `,
  styles: [`
    .event-card {
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid #e8e0d6;
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: box-shadow 0.2s, transform 0.15s;
      &:hover { box-shadow: 0 6px 20px rgba(61,28,5,0.12); transform: translateY(-2px); }
    }
    .cancelled { opacity: 0.85; }
    .draft { opacity: 0.85; }

    // ── Photo header ──────────────────────────────────────────────────────────

    .card-photo {
      position: relative;
      height: 160px;
      overflow: hidden;
      background: linear-gradient(135deg, var(--db-brown-dark) 0%, var(--db-brown-mid) 100%);
      &.compact { height: 110px; }
      img { width: 100%; height: 100%; object-fit: cover; display: block; }
    }

    .card-photo-placeholder { width: 100%; height: 100%; }

    .card-photo-fade {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 50%;
      background: linear-gradient(to bottom, transparent, rgba(44, 21, 3, 0.35));
      pointer-events: none;
    }

    .cancelled-overlay, .draft-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      color: #fff;
      text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .cancelled-overlay { background: var(--db-red-overlay); }
    .draft-overlay { background: rgba(160, 110, 0, 0.68); }

    // ── Card body ─────────────────────────────────────────────────────────────

    .card-body { padding: 12px 14px 10px; }

    .card-date {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--db-amber);
      margin-bottom: 2px;
    }

    .card-city { font-size: 0.72rem; color: #999; margin-bottom: 3px; }

    .card-restaurant {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--db-brown);
      margin-bottom: 0;
      &.muted { color: #b00000; }
    }

    // ── Footer ────────────────────────────────────────────────────────────────

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px 10px;
      border-top: 1px solid rgba(44, 21, 3, 0.12);
      min-height: 40px;
    }

    .footer-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .footer-right { flex-shrink: 0; }

    // Avatar cluster
    .avatar-cluster {
      display: flex;
      align-items: center;
    }

    .avatar-chip {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #F5DEB3;
      color: #3D1C05;
      font-size: 0.6rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #fff;
      margin-left: -6px;
      position: relative;
      flex-shrink: 0;
      &:first-child { margin-left: 0; }
    }

    .going-count {
      font-size: 0.78rem;
      color: #888;
      white-space: nowrap;
    }

    // RSVP pill
    .rsvp-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      line-height: 1;
    }

    .rsvp-pill--cta {
      background: #C8860A;
      color: #fff;
      border: none;
    }

    .rsvp-pill--done {
      background: transparent;
      color: #2e7d32;
      border: 1.5px solid #2e7d32;
    }

    .rsvp-pill-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    // Cancelled footer badge
    .cancelled-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #b00000;
      font-size: 0.78rem;
      font-weight: 600;
    }

    .cancelled-badge-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
  `],
})
export class EventCardComponent {
  @Input({ required: true }) event!: Event;
  @Input() compact = false;

  get snippet() { return this.event.attendeeSnippet ?? []; }
  get totalAttending() { return this.event.totalAttending ?? this.event.goingCount ?? 0; }
  get isPast(): boolean {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return this.event.eventDate < todayStr;
  }

  initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}
