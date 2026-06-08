import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, SlicePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventsService, Event } from '../../core/services/events.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    DatePipe,
    SlicePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <!-- Hero -->
    <section class="hero">
      <div class="hero-text">
        <span class="eyebrow">Cincinnati &amp; Dayton</span>
        <h1>Good food.<br>Good people.<br><em>Every week.</em></h1>
        <p class="hero-sub">
          DinnerBears is an invite-only community for people who love discovering
          great restaurants together. Weekly dinners, real connections.
        </p>
        @if (isLoggedIn()) {
          <a mat-raised-button color="primary" routerLink="/events" class="cta-btn">
            <mat-icon>event</mat-icon> View All Events
          </a>
        } @else {
          <a mat-raised-button color="primary" routerLink="/login" class="cta-btn">
            <mat-icon>login</mat-icon> Sign In to RSVP
          </a>
        }
      </div>

      <div class="hero-events">
        @if (loading()) {
          <div class="events-loading"><mat-spinner diameter="36" /></div>
        } @else if (events().length === 0) {
          <div class="no-events">
            <mat-icon>event_busy</mat-icon>
            <p>No upcoming events right now.<br>Check back soon!</p>
          </div>
        } @else {
          <div class="event-cards">
            @for (e of events(); track e.id) {
              <div class="event-card" [class.cancelled]="e.status === 'cancelled'" (click)="goToEvent(e)" role="button" tabindex="0" (keydown.enter)="goToEvent(e)">
                <div class="card-photo">
                  @if (e.restaurant?.photos?.length) {
                    <img [src]="e.restaurant!.photos[0].filePath" [alt]="e.restaurantName" />
                  }
                  @if (e.status === 'cancelled') {
                    <div class="cancelled-overlay">CANCELLED</div>
                  }
                </div>
                <div class="card-body">
                  <div class="card-date">{{ e.eventDate | date: 'EEE, MMM d' }} &middot; {{ formatTime(e.eventTime) }}</div>
                  <div class="card-city">{{ e.city.name }}</div>
                  <div class="card-restaurant" [class.cancelled-name]="e.status === 'cancelled'">
                    @if (e.status === 'cancelled') { <span class="cancelled-prefix">CANCELLED:</span> }
                    {{ e.restaurantName }}
                  </div>
                  @if (e.description) {
                    <p class="card-desc">{{ e.description | slice:0:100 }}{{ e.description.length > 100 ? '…' : '' }}</p>
                  }
                  <div class="card-actions">
                    @if (isLoggedIn()) {
                      <a mat-raised-button color="primary" [routerLink]="['/events', e.id]" class="rsvp-btn" (click)="$event.stopPropagation()">
                        RSVP
                      </a>
                    } @else {
                      <a mat-raised-button color="primary" routerLink="/login" class="rsvp-btn" (click)="$event.stopPropagation()">
                        Sign in to RSVP
                      </a>
                    }
                    <button mat-icon-button class="share-btn" (click)="shareToFacebook(e, $event)" title="Share on Facebook">
                      <mat-icon>share</mat-icon>
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </section>

    <!-- Cities -->
    <section class="cities-bar">
      <span class="city-pill">📍 Cincinnati</span>
      <span class="city-divider">·</span>
      <span class="city-pill">📍 Dayton</span>
    </section>

    <!-- How it works -->
    <section class="how">
      <span class="section-label">How it works</span>
      <h2>Simple, social, delicious.</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">01</div>
          <h3>Get Invited</h3>
          <p>DinnerBears is invite-only. A current member sends you a link to join.</p>
        </div>
        <div class="step">
          <div class="step-num">02</div>
          <h3>See the Week's Dinner</h3>
          <p>Each week a new restaurant is chosen. Browse the details and who's coming.</p>
        </div>
        <div class="step">
          <div class="step-num">03</div>
          <h3>RSVP &amp; Show Up</h3>
          <p>Claim your spot, show up, and enjoy a great meal with great people.</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      font-family: 'DM Sans', 'Roboto', sans-serif;
    }

    /* HERO */
    .hero {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3rem;
      align-items: start;
      padding: 2rem 0 4rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    .eyebrow {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 500;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--db-accent);
      border: 1px solid var(--db-accent);
      padding: 0.3rem 0.8rem;
      border-radius: 2px;
      margin-bottom: 1.25rem;
    }

    h1 {
      font-size: clamp(2.2rem, 4vw, 3.5rem);
      font-weight: 800;
      line-height: 1.1;
      color: var(--db-brown-dark);
      margin: 0 0 1.25rem;
      em { font-style: italic; color: var(--db-accent); }
    }

    .hero-sub {
      font-size: 1.05rem;
      line-height: 1.7;
      color: #666;
      max-width: 440px;
      margin-bottom: 2rem;
    }

    .cta-btn { font-size: 1rem; padding: 0 24px; height: 48px; }

    /* EVENT CARDS */
    .hero-events { padding-top: 0.5rem; }

    .events-loading, .no-events {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      gap: 12px;
      color: #999;
      mat-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
      p { text-align: center; line-height: 1.5; }
    }

    .event-cards { display: flex; flex-direction: column; gap: 16px; }

    .event-card {
      background: #fff;
      border: 1px solid #e8e0d6;
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.15s;
      &:hover { box-shadow: 0 6px 20px rgba(61,28,5,0.12); transform: translateY(-2px); }
    }

    .card-photo {
      position: relative;
      height: 140px;
      overflow: hidden;
      background: #e8e0d6;
      img { width: 100%; height: 100%; object-fit: cover; display: block; }
    }

    .cancelled-overlay {
      position: absolute;
      inset: 0;
      background: rgba(180, 0, 0, 0.72);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      color: #fff;
      text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    .cancelled-name { color: #b00000; }
    .cancelled-prefix { font-weight: 700; margin-right: 4px; }

    .card-body { padding: 14px 16px; }

    .card-date {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--db-primary);
      margin-bottom: 2px;
    }

    .card-city { font-size: 0.75rem; color: #999; margin-bottom: 4px; }

    .card-restaurant {
      font-size: 1rem;
      font-weight: 600;
      color: var(--db-brown-dark);
      margin-bottom: 4px;
    }

    .card-desc { font-size: 0.85rem; color: #666; line-height: 1.4; margin: 0 0 10px; }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
    }

    .rsvp-btn { font-size: 0.85rem; height: 36px; line-height: 36px; }

    .share-btn { color: #999; }

    /* CITIES BAR */
    .cities-bar {
      background: var(--db-primary);
      padding: 1.5rem 2rem;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 1.5rem;
    }

    .city-pill {
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: 0.03em;
    }

    .city-divider { color: rgba(255,255,255,0.4); font-size: 1.5rem; }

    /* HOW IT WORKS */
    .how {
      padding: 5rem 2rem;
      max-width: 900px;
      margin: 0 auto;
    }

    .section-label {
      display: block;
      font-size: 0.75rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--db-accent);
      font-weight: 500;
      margin-bottom: 0.75rem;
    }

    .how h2 {
      font-size: 2rem;
      font-weight: 700;
      color: var(--db-brown-dark);
      margin: 0 0 3rem;
    }

    .steps {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2.5rem;
    }

    .step-num {
      font-size: 3rem;
      font-weight: 900;
      color: rgba(201, 147, 58, 0.2);
      line-height: 1;
      margin-bottom: 0.75rem;
    }

    .step h3 { font-size: 1.1rem; font-weight: 600; color: var(--db-brown-dark); margin: 0 0 0.5rem; }
    .step p { font-size: 0.9rem; color: #666; line-height: 1.6; margin: 0; }

    @media (max-width: 768px) {
      .hero { grid-template-columns: 1fr; padding: 1rem 0 3rem; }
      .steps { grid-template-columns: 1fr; gap: 2rem; }
      .how { padding: 3rem 1rem; }
    }
  `],
})
export class HomeComponent implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly events = signal<Event[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.eventsService.getAll({ upcoming: true }).subscribe({
      next: (evts) => { this.events.set(evts.slice(0, 3)); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  goToEvent(e: Event): void {
    void this.router.navigate(['/events', e.id]);
  }

  shareToFacebook(e: Event, $event: MouseEvent): void {
    $event.stopPropagation();
    const url = encodeURIComponent(`${window.location.origin}/events/${e.id}`);
    const text = encodeURIComponent(
      `Join us at DinnerBears! 🐻🍽️\n${e.title}\n${e.restaurantName} · ${new Date(e.eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${this.formatTime(e.eventTime)}`
    );
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`, '_blank', 'width=600,height=400');
  }
}
