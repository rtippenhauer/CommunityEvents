import { Component, Input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from '../../../core/services/events.service';

@Component({
  selector: 'app-event-card',
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule],
  template: `
    <a class="event-card" [class.cancelled]="event.status === 'cancelled'" [class.draft]="event.status === 'draft'" [routerLink]="['/events', event.id]">
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
        @if (event.status === 'published' && goingCount > 0) {
          <div class="going-badge">
            <mat-icon class="going-badge-icon">people</mat-icon>
            {{ goingCount }} going
          </div>
        }
        <div class="card-photo-fade"></div>
      </div>

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

    .card-photo {
      position: relative;
      height: 160px;
      overflow: hidden;
      background: linear-gradient(135deg, var(--db-brown-dark) 0%, var(--db-brown-mid) 100%);
      &.compact { height: 110px; }
      img { width: 100%; height: 100%; object-fit: cover; display: block; }
    }

    .card-photo-placeholder { width: 100%; height: 100%; }

    .going-badge {
      position: absolute;
      bottom: 8px;
      right: 8px;
      background: rgba(0,0,0,0.55);
      color: #fff;
      border-radius: 12px;
      padding: 3px 8px;
      font-size: 0.72rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 3px;
      backdrop-filter: blur(4px);
    }
    .going-badge-icon { font-size: 13px; width: 13px; height: 13px; }

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

    .card-body { padding: 12px 14px; }

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
      margin-bottom: 4px;
      &.muted { color: #b00000; }
    }

  `],
})
export class EventCardComponent {
  @Input({ required: true }) event!: Event;
  @Input() compact = false;

  get goingCount(): number { return this.event.goingCount ?? this.event.rsvps?.length ?? 0; }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}
