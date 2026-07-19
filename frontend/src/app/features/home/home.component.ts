import { Component, effect, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventsService, Event } from '../../core/services/events.service';
import { AuthService } from '../../core/services/auth.service';
import { CityService } from '../../core/services/city.service';
import { EventCardComponent } from '../../shared/components/event-card/event-card.component';

interface PublicStats {
  memberCount: number;
  dinnerCount: number;
  restaurantCount: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    EventCardComponent,
  ],
  template: `
    <!-- Hero -->
    <section class="hero">
      <div class="hero-text">
        <span class="eyebrow">Cincinnati &amp; Dayton</span>
        <h1>Good food.<br />Good people.<br /><em>Every week.</em></h1>
        <p class="hero-sub">
          DinnerBears is an invite-only community for people who love discovering great restaurants
          together. Weekly dinners, real connections.
        </p>
        <div class="hero-actions">
          <a mat-raised-button color="primary" routerLink="/calendar" class="cta-btn">
            <mat-icon>calendar_month</mat-icon> View Calendar
          </a>
          <a mat-stroked-button class="cta-btn-secondary" (click)="scrollToStory()">
            <mat-icon>auto_stories</mat-icon> Our Story
          </a>
          @if (!isLoggedIn()) {
            <a mat-stroked-button routerLink="/login" class="cta-btn-secondary">Sign in</a>
          }
        </div>
      </div>

      <div class="hero-events">
        @if (loading()) {
          <div class="events-loading"><mat-spinner diameter="36" /></div>
        } @else if (events().length === 0) {
          <div class="no-events">
            <mat-icon>event_busy</mat-icon>
            <p>No upcoming dinners right now.<br />Check back soon!</p>
          </div>
        } @else {
          <h3 class="upcoming-label">Upcoming Dinners</h3>
          <div class="event-cards">
            @for (e of events(); track e.id) {
              <app-event-card [event]="e" />
            }
          </div>
          <a routerLink="/events" class="see-all-link">See all events →</a>
        }
      </div>
    </section>

    <!-- Stats strip -->
    @if (stats()) {
      <section class="stats-strip">
        <div class="stat">
          <span class="stat-number">{{ stats()!.memberCount }}</span>
          <span class="stat-label">Members</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat">
          <span class="stat-number">{{ stats()!.dinnerCount }}</span>
          <span class="stat-label">Dinners Had</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat">
          <span class="stat-number">{{ stats()!.restaurantCount }}</span>
          <span class="stat-label">Restaurants</span>
        </div>
      </section>
    }

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

    <!-- Our Story / Map -->
    <section class="story-section" id="story">
      <div class="story-inner">
        <div class="story-map" (click)="showMapLightbox.set(true)">
          <img
            src="/images/story-map.png"
            alt="Places We've Been — DinnerBears restaurant map"
            class="map-img"
          />
          <p class="map-caption">🐾 Places We've Been — Cincinnati &amp; Dayton</p>
        </div>

        @if (showMapLightbox()) {
          <div class="map-lightbox" (click)="showMapLightbox.set(false)">
            <button
              class="lightbox-close"
              (click)="$event.stopPropagation(); showMapLightbox.set(false)"
            >
              ✕
            </button>
            <img
              src="/images/story-map.png"
              alt="DinnerBears restaurant map — full size"
              (click)="$event.stopPropagation()"
            />
          </div>
        }
        <div class="story-copy">
          <span class="section-label">EST. FEBRUARY 2014</span>
          <h2 class="story-headline">One simple act.<br />A lifetime of bear memories.</h2>
          <p class="story-p">
            On February 22, 2014, Rob Tippenhauer helped his husband Terry Wachtman's old karate
            instructor at a small sushi restaurant in Kentucky. As a thank-you, the instructor
            introduced them both to Chuy's. The very next Tuesday Rob was back — hooked on the free
            queso bar. Terry joined at 7:00 PM after Tai Chi class, and neither of them left. Within
            a few weeks, TJVBear and OhioBear started joining regularly. As the group kept growing,
            Terry found himself spending afternoons each week tracking down who planned to come — so
            Rob created a Facebook event to manage attendance and duplicated it week after week.
          </p>
          <p class="story-p">
            After nearly two years of Tuesday nights at Chuy's, the group was ready to branch out.
            But the Facebook event format had a frustrating flaw: when someone declined, they were
            dropped from future invites entirely. On February 21, 2016, Rob solved both problems at
            once by creating the
            <em>Cincinnati Tuesday Night Bear Dinners</em> private Facebook Group. The process was
            simple: members nominate restaurants at each dinner, everyone votes, the top vote-getter
            wins, whoever suggested it makes the reservation, and Rob posts the event to the group.
            As the restaurant list grew and the weekly write-ups got more elaborate, managing it
            became a real chore — and members without Facebook were missing out. So in June 2026,
            Rob built DinnerBears.com to take its place. We're actively adding features: sign-in
            with Facebook or Google, +1 RSVPs, and restaurant ratings.
          </p>
          <blockquote class="story-quote">
            "It's amazing what one simple act of helping someone in a time of need has led to in a
            few short years."
          </blockquote>
          <div class="story-milestones">
            <div class="milestone">
              <span class="ms-date">Feb 22, 2014</span
              ><span class="ms-text"
                >Rob helps Terry's karate instructor — introduced to Chuy's as a thank-you</span
              >
            </div>
            <div class="milestone">
              <span class="ms-date">Spring 2014</span
              ><span class="ms-text"
                >TJVBear &amp; OhioBear join; Facebook events created to track weekly
                attendance</span
              >
            </div>
            <div class="milestone">
              <span class="ms-date">Sept 1, 2015</span
              ><span class="ms-text">First official Facebook event invite sent to the group</span>
            </div>
            <div class="milestone">
              <span class="ms-date">Feb 21, 2016</span
              ><span class="ms-text"
                >Cincinnati Tuesday Night Bear Dinners Group founded — rotating restaurants &amp;
                voting begins</span
              >
            </div>
            <div class="milestone">
              <span class="ms-date">Aug 3, 2016</span
              ><span class="ms-text">First monthly Dayton dinner launched</span>
            </div>
            <div class="milestone">
              <span class="ms-date">June 2026</span
              ><span class="ms-text"
                >DinnerBears.com launches — purpose-built home with Google &amp; Facebook login, +1
                RSVPs, and restaurant ratings</span
              >
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
        font-family: var(--db-font-body), 'Roboto', sans-serif;
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
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--db-accent);
        border: 1px solid var(--db-accent);
        padding: 0.3rem 0.8rem;
        border-radius: 2px;
        margin-bottom: 1.25rem;
      }

      h1 {
        font-family: var(--db-font-display);
        font-size: clamp(2.2rem, 4vw, 3.4rem);
        font-weight: 600;
        line-height: 1.12;
        color: var(--db-brown-dark);
        margin: 0 0 1.25rem;
        em {
          font-style: italic;
          color: var(--db-accent);
        }
      }

      .hero-sub {
        font-size: 1.02rem;
        line-height: 1.7;
        color: #666;
        max-width: 440px;
        margin-bottom: 2rem;
      }

      .hero-actions {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .cta-btn {
        font-size: 1rem;
        padding: 0 20px;
        height: 44px;
      }
      .cta-btn-secondary {
        font-size: 0.9rem;
      }

      /* UPCOMING EVENTS */
      .hero-events {
        padding-top: 0.5rem;
      }
      .upcoming-label {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--db-accent);
        margin: 0 0 12px;
      }

      .events-loading,
      .no-events {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        gap: 12px;
        color: #999;
        mat-icon {
          font-size: 2.5rem;
          width: 2.5rem;
          height: 2.5rem;
        }
        p {
          text-align: center;
          line-height: 1.5;
        }
      }

      .event-cards {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .see-all-link {
        display: inline-block;
        margin-top: 14px;
        font-size: 0.85rem;
        color: var(--db-accent);
        text-decoration: none;
        font-weight: 500;
        &:hover {
          text-decoration: underline;
        }
      }

      /* STATS STRIP — negative margins break out of app-content padding */
      .stats-strip {
        background: var(--db-brown-nav);
        padding: 2rem;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0;
        margin: 0 -16px;

        @media (min-width: 768px) {
          margin: 0 -24px;
        }
      }

      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 0 3rem;
      }

      .stat-number {
        font-family: var(--db-font-display);
        font-size: 2.4rem;
        font-weight: 600;
        color: var(--db-amber);
        line-height: 1;
      }

      .stat-label {
        font-size: 0.72rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--db-cream-muted);
      }

      .stat-divider {
        width: 1px;
        height: 40px;
        background: rgba(255, 255, 255, 0.12);
      }

      /* HOW IT WORKS */
      .how {
        padding: 5rem 2rem;
        max-width: 900px;
        margin: 0 auto;
      }

      .section-label {
        display: block;
        font-size: 0.72rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--db-accent);
        font-weight: 600;
        margin-bottom: 0.75rem;
      }

      .how h2 {
        font-family: var(--db-font-display);
        font-size: 2rem;
        font-weight: 600;
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
        color: rgba(201, 147, 58, 0.18);
        line-height: 1;
        margin-bottom: 0.75rem;
      }

      .step h3 {
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--db-brown-dark);
        margin: 0 0 0.5rem;
      }
      .step p {
        font-size: 0.9rem;
        color: #666;
        line-height: 1.6;
        margin: 0;
      }

      /* OUR STORY — negative margins break out of app-content padding */
      .story-section {
        background: var(--db-brown-nav);
        padding: 5rem 2rem;
        margin: 0 -16px;

        @media (min-width: 768px) {
          margin: 0 -24px;
        }
      }

      .story-inner {
        max-width: 1100px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4rem;
        align-items: center;
      }

      .story-map {
        text-align: center;
      }

      .map-img {
        width: 100%;
        border-radius: 10px;
        box-shadow: 0 8px 36px rgba(0, 0, 0, 0.35);
      }

      .map-caption {
        margin-top: 0.75rem;
        font-size: 0.75rem;
        color: var(--db-cream-muted);
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .story-copy .section-label {
        color: var(--db-amber);
      }

      .story-headline {
        font-family: var(--db-font-display);
        font-size: 2rem;
        font-weight: 600;
        color: var(--db-cream);
        line-height: 1.2;
        margin: 0.5rem 0 1.25rem;
      }

      .story-p {
        font-size: 0.93rem;
        color: var(--db-cream-muted);
        line-height: 1.8;
        margin: 0 0 1rem;
      }

      .story-quote {
        border-left: 3px solid var(--db-amber);
        padding: 0.65rem 1.1rem;
        font-style: italic;
        font-size: 0.92rem;
        color: var(--db-cream);
        background: rgba(255, 255, 255, 0.04);
        border-radius: 0 4px 4px 0;
        margin: 1.25rem 0 1.5rem;
      }

      .story-milestones {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .milestone {
        display: flex;
        gap: 1rem;
        font-size: 0.85rem;
        align-items: baseline;
      }

      .ms-date {
        color: var(--db-amber);
        font-weight: 600;
        white-space: nowrap;
        width: 105px;
        flex-shrink: 0;
      }

      .ms-text {
        color: var(--db-cream-muted);
        line-height: 1.4;
      }

      /* MAP LIGHTBOX */
      .story-map {
        cursor: zoom-in;
        .map-img {
          transition: opacity 0.15s;
        }
        &:hover .map-img {
          opacity: 0.88;
        }
      }

      .map-lightbox {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.88);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        cursor: zoom-out;

        img {
          max-width: 90vw;
          max-height: 90vh;
          border-radius: 8px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          cursor: default;
        }
      }

      .lightbox-close {
        position: absolute;
        top: 1.5rem;
        right: 1.5rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.35);
        color: white;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        &:hover {
          background: rgba(255, 255, 255, 0.22);
        }
      }

      @media (max-width: 768px) {
        .hero {
          grid-template-columns: 1fr;
          padding: 1rem 0 3rem;
        }
        .steps {
          grid-template-columns: 1fr;
          gap: 2rem;
        }
        .how {
          padding: 3rem 1rem;
        }
        .stat {
          padding: 0 1.5rem;
        }
        .stat-number {
          font-size: 1.8rem;
        }
        .story-section {
          padding: 3rem 1.25rem;
        }
        .story-inner {
          grid-template-columns: 1fr;
          gap: 2rem;
        }
      }
    `,
  ],
})
export class HomeComponent implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);
  private readonly cityService = inject(CityService);
  private readonly http = inject(HttpClient);

  readonly events = signal<Event[]>([]);
  readonly loading = signal(true);
  readonly stats = signal<PublicStats | null>(null);
  readonly showMapLightbox = signal(false);

  private readonly loadEventsEffect = effect(() => {
    // Re-runs once currentCity() resolves from undefined -> a city (or stays
    // undefined on www/apex/stage), so the very first fetch already reflects
    // whichever subdomain the visitor is on.
    const cityId = this.cityService.currentCity()?.id;
    this.loading.set(true);
    this.eventsService.getAll({ upcoming: true, cityId }).subscribe({
      next: (evts) => {
        this.events.set(evts.slice(0, 3));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  });

  ngOnInit(): void {
    this.http.get<PublicStats>('/api/v1/stats/public').subscribe({
      next: (s) => this.stats.set(s),
      error: () => {
        /* stats are non-critical, fail silently */
      },
    });
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  scrollToStory(): void {
    document.getElementById('story')?.scrollIntoView({ behavior: 'smooth' });
  }
}
