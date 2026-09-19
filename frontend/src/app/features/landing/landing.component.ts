import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BrandConfigService } from '../../core/services/brand-config.service';

/**
 * The root tenant's public landing page (v2-13) — the marketing front door at
 * www.communityeventsproject.com, explaining what the project is and sending
 * visitors to the demo.
 *
 * Rendered at `/` only for a signed-out visitor on the root tenant; see
 * `rootLandingGuard`, which is where that decision is explained.
 *
 * It renders inside the ordinary app shell rather than replacing it, unlike
 * `TenantUnavailableComponent`. That page has no tenant and so deliberately
 * owns its own chrome; this one *is* the root tenant, so it has real branding
 * to wear, and the shell already hides every member nav item behind
 * `isLoggedIn()` — a signed-out visitor gets the mark, a Sign In button and
 * the footer's Terms/Privacy links, which is what a marketing page wants
 * anyway. Duplicating that chrome here would be a second header free to drift
 * from the real one.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  private readonly brandConfig = inject(BrandConfigService);

  /**
   * The root tenant's own configured name. This page is the platform's front
   * door, so the name it wears is the operator's — the same value every other
   * surface reads, not a compiled-in "CommunityEvents" that would disagree the
   * moment an operator renames their deployment.
   */
  readonly brandName = computed(() => this.brandConfig.brand().name);

  /**
   * Matches `HomeComponent.scrollToStory()` rather than relying on a `#how`
   * fragment href: the router is on `PathLocationStrategy` with no anchor
   * scrolling configured, so a fragment link is at the mercy of how the
   * browser and the router divide a URL change between them. This is the
   * idiom already proven in this app.
   */
  scrollToHow(): void {
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
  }

  readonly features = [
    {
      icon: 'event',
      title: 'Events and RSVPs',
      body: 'Recurring events with a seat limit and a cutoff, so organisers know the count before they have to give one.',
    },
    {
      icon: 'restaurant',
      title: 'Somewhere to go',
      body: 'A shared list of venues the community actually uses, with ratings and notes from the people who went.',
    },
    {
      icon: 'group',
      title: 'An invite-only roster',
      body: 'Membership is by invitation, so a community stays the group of people it started as rather than whoever found the link.',
    },
    {
      icon: 'emoji_events',
      title: 'Points and achievements',
      body: 'A leaderboard and a catalogue of achievements each community writes for itself, to keep turnout from resting on the same few people.',
    },
    {
      icon: 'calendar_month',
      title: 'On their real calendar',
      body: 'A subscribable feed, so events land in the calendar members already look at instead of one more app to check.',
    },
    {
      icon: 'notifications',
      title: 'Reminders that arrive',
      body: 'Email and push notifications for new events, seats running out and the cutoff approaching.',
    },
  ];
}
