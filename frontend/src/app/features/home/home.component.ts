import { Component, effect, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventsService, Event } from '../../core/services/events.service';
import { AuthService } from '../../core/services/auth.service';
import { CityService } from '../../core/services/city.service';
import { AppConfigService } from '../../core/services/app-config.service';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { normalizeNbsp } from '../../shared/utils/normalize-nbsp';
import { EventCardComponent } from '../../shared/components/event-card/event-card.component';

interface PublicStats {
  memberCount: number;
  dinnerCount: number;
  locationCount: number;
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
        @if (hasContent(heroContent())) {
          <div class="hero-copy" [innerHTML]="heroHtml()"></div>
        } @else {
          <div class="hero-copy">
            <h1>Welcome to {{ brandName().name }}</h1>
            <p>An invite-only community. Sign in to see what's coming up.</p>
          </div>
        }
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
            <p>No upcoming {{ brandConfig.dinnerPluralLower() }} right now.<br />Check back soon!</p>
          </div>
        } @else {
          <h3 class="upcoming-label">Upcoming {{ brandConfig.dinnerPlural() }}</h3>
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
    @if (showStats() && stats()) {
      <section class="stats-strip">
        <div class="stat">
          <span class="stat-number">{{ stats()!.memberCount }}</span>
          <span class="stat-label">Members</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat">
          <span class="stat-number">{{ stats()!.dinnerCount }}</span>
          <span class="stat-label">{{ brandConfig.dinnerPlural() }} Had</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat">
          <span class="stat-number">{{ stats()!.locationCount }}</span>
          <span class="stat-label">{{ brandConfig.locationPlural() }}</span>
        </div>
      </section>
    }

    <!-- How it works (editable rich-text block; hidden when empty) -->
    @if (hasContent(howItWorksContent())) {
      <section class="how">
        <span class="section-label">How it works</span>
        <div class="how-copy" [innerHTML]="howItWorksHtml()"></div>
      </section>
    }

    <!-- Our Story -->
    @if (brandConfig.storyImageUrl() || hasContent(storyContent())) {
      <section class="story-section" id="story">
        <div class="story-inner" [class.no-story-image]="!brandConfig.storyImageUrl()">
          @if (brandConfig.storyImageUrl(); as storyImg) {
            <div class="story-map" (click)="showMapLightbox.set(true)">
              <img [src]="storyImg" [alt]="brandName().name + ' story'" class="map-img" />
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
                  [src]="storyImg"
                  [alt]="brandName().name + ' story'"
                  (click)="$event.stopPropagation()"
                />
              </div>
            }
          }
          <div class="story-copy" [innerHTML]="storyHtml()"></div>
        </div>
      </section>
    }
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

      /* Editable hero rich-text block (home_hero_html). Styles the plain tags
         the admin rich-text editor produces so a fork's hero reads like the
         built-in one without needing specific CSS classes. */
      .hero-copy {
        margin-bottom: 2rem;
        max-width: 460px;
        ::ng-deep {
          h1,
          h2 {
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
          h3 {
            font-family: var(--db-font-display);
            font-size: 1.4rem;
            color: var(--db-brown-dark);
            margin: 0 0 0.75rem;
          }
          p {
            font-size: 1.02rem;
            line-height: 1.7;
            color: #666;
            margin: 0 0 1rem;
          }
          a {
            color: var(--db-accent);
          }
        }
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
        color: var(--db-accent-on-dark, var(--db-amber));
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

      /* Editable "How it works" rich-text block (home_howitworks_html). Styles
         the plain tags the admin editor produces, on the light section bg.
         Each <h3> gets an auto-numbered step marker (01, 02, …), and the steps
         flow into a responsive multi-column layout to echo the built-in look. */
      .how-copy {
        counter-reset: how-step;
        max-width: 720px;
        ::ng-deep {
          h2 {
            font-family: var(--db-font-display);
            font-size: 2rem;
            font-weight: 600;
            color: var(--db-brown-dark);
            margin: 0 0 2rem;
          }
          h3 {
            counter-increment: how-step;
            font-family: var(--db-font-display);
            font-size: 1.15rem;
            font-weight: 600;
            color: var(--db-brown-dark);
            margin: 1.75rem 0 0.35rem;
            &::before {
              content: '0' counter(how-step) '  ';
              font-weight: 900;
              color: var(--db-accent);
              opacity: 0.55;
              margin-right: 0.4rem;
            }
          }
          p {
            font-size: 0.92rem;
            line-height: 1.65;
            color: #666;
            margin: 0 0 0.5rem;
            padding-left: 2.1rem;
          }
          a {
            color: var(--db-accent);
          }

          /* Optional structured grid: if the HTML uses the .steps/.step/.step-num
             markup (set via SQL — the WYSIWYG editor can't make divs), it renders
             as the original three-column 01/02/03 grid instead of the prose list. */
          .steps {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 2.5rem;
            margin-top: 1rem;
          }
          .step-num {
            font-size: 3rem;
            font-weight: 900;
            line-height: 1;
            color: var(--db-accent);
            opacity: 0.28;
            margin-bottom: 0.5rem;
          }
          .step h3 {
            margin: 0 0 0.4rem;
            &::before {
              content: none;
            }
          }
          .step p {
            padding-left: 0;
          }
          @media (max-width: 768px) {
            .steps {
              grid-template-columns: 1fr;
            }
          }
        }
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

      /* No story image uploaded → story copy spans the full width. */
      .story-inner.no-story-image {
        grid-template-columns: 1fr;
        max-width: 720px;
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

      .story-copy {
        /* Base color for admin-entered story HTML sitting on the dark story
           band. The DinnerBears default copy carries .story-* classes (styled
           below); a fork's plain <p>/<h*> from the rich-text editor inherits
           these instead of defaulting to unreadable dark text. */
        color: var(--db-cream-muted);
        line-height: 1.8;

        ::ng-deep {
          h1,
          h2,
          h3,
          h4,
          strong,
          b {
            color: var(--db-cream);
          }
          a {
            color: var(--db-accent-on-dark, var(--db-amber));
          }
        }

        ::ng-deep .section-label {
          color: var(--db-accent-on-dark, var(--db-amber));
        }

        ::ng-deep .story-headline {
          font-family: var(--db-font-display);
          font-size: 2rem;
          font-weight: 600;
          color: var(--db-cream);
          line-height: 1.2;
          margin: 0.5rem 0 1.25rem;
        }

        ::ng-deep .story-p {
          font-size: 0.93rem;
          color: var(--db-cream-muted);
          line-height: 1.8;
          margin: 0 0 1rem;
        }

        ::ng-deep .story-quote {
          border-left: 3px solid var(--db-accent-on-dark, var(--db-amber));
          padding: 0.65rem 1.1rem;
          font-style: italic;
          font-size: 0.92rem;
          color: var(--db-cream);
          background: rgba(255, 255, 255, 0.04);
          border-radius: 0 4px 4px 0;
          margin: 1.25rem 0 1.5rem;
        }

        ::ng-deep .story-milestones {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }

        ::ng-deep .milestone {
          display: flex;
          gap: 1rem;
          font-size: 0.85rem;
          align-items: baseline;
        }

        ::ng-deep .ms-date {
          color: var(--db-accent-on-dark, var(--db-amber));
          font-weight: 600;
          white-space: nowrap;
          width: 105px;
          flex-shrink: 0;
        }

        ::ng-deep .ms-text {
          color: var(--db-cream-muted);
          line-height: 1.4;
        }
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
  private readonly appConfigService = inject(AppConfigService);
  readonly brandConfig = inject(BrandConfigService);
  private readonly sanitizer = inject(DomSanitizer);

  // Instance name for the hero fallback + how-it-works copy.
  readonly brandName = this.brandConfig.brand;

  readonly events = signal<Event[]>([]);
  readonly loading = signal(true);
  readonly stats = signal<PublicStats | null>(null);
  readonly showStats = signal(true);
  readonly showMapLightbox = signal(false);
  readonly storyContent = signal('');
  readonly heroContent = signal('');
  readonly howItWorksContent = signal('');

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
    this.appConfigService.getValue('about_story_html').subscribe({
      next: (value) => this.storyContent.set(value),
      error: () => this.storyContent.set(''),
    });
    this.appConfigService.getValue('home_hero_html').subscribe({
      next: (value) => this.heroContent.set(value),
      error: () => this.heroContent.set(''),
    });
    this.appConfigService.getValue('home_howitworks_html').subscribe({
      next: (value) => this.howItWorksContent.set(value),
      error: () => this.howItWorksContent.set(''),
    });
    this.appConfigService.getValue('home_show_stats').subscribe({
      next: (value) => this.showStats.set(value !== 'false'),
      error: () => this.showStats.set(true),
    });
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  scrollToStory(): void {
    document.getElementById('story')?.scrollIntoView({ behavior: 'smooth' });
  }

  storyHtml(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.storyContent()));
  }

  heroHtml(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.heroContent()));
  }

  howItWorksHtml(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.howItWorksContent()));
  }

  // The rich-text editor stores "<p><br></p>" (not "") when a block is cleared,
  // so treat any markup with no visible text/media as empty — that's what lets
  // clearing a block in the editor actually hide its home-page section.
  hasContent(html: string): boolean {
    if (!html) return false;
    // Parse rather than regex-strip tags: DOMParser reads visible text via
    // textContent without executing scripts or loading resources, and avoids
    // the incomplete-sanitization pitfalls of single-pass tag removal.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('img, iframe, video')) return true;
    return normalizeNbsp(doc.body.textContent ?? '').trim().length > 0;
  }
}
