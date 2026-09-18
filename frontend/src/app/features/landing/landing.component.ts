import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BrandConfigService } from '../../core/services/brand-config.service';

/**
 * The subdomain the demo tenant (v2-14) is created at, on any deployment.
 *
 * Mirrored by `DEMO_SUBDOMAIN` / `demoDomainFor` in the API's
 * `common/utils/tenant-domain.util.ts`, which is what `provision-demo.ts`
 * actually creates the tenant at. The two must agree or this page links to a
 * host no tenant answers on — the same mirroring `roles.util.ts` and
 * `color.util.ts` carry, and for the same reason: this page is served to
 * visitors of the root community, so it cannot ask the API where a community
 * that may not exist yet would live.
 */
export const DEMO_SUBDOMAIN = 'demo';

/**
 * The demo's address, derived from the root tenant's own URL rather than
 * written down (v2-13).
 *
 * A literal `https://demo.communityeventsproject.com` would be a
 * deployment-specific value compiled into the bundle — the thing v2-6 spent an
 * item moving out of code — and one image serves both stage and production, so
 * it would be wrong on one of them by construction.
 *
 * Deriving it also decides something more useful than the spelling. `demo.` on
 * the *deployment's own domain* is a subdomain of it, so `isOnDeploymentDomain`
 * is true and the demo inherits this deployment's Brevo and Google credentials.
 * A demo at `demo.communityeventsproject.com` created against the stage
 * deployment (`stage.communityeventsproject.com`) would be a sibling, not a
 * subdomain — treated as a community bringing its own domain, which withholds
 * both, and an invite-gated community with no mail is one nobody can join.
 *
 * Returns '' for a URL it cannot parse, and the page hides the link rather
 * than rendering a broken one — the same thing `supportEmail` does with its
 * mailto.
 */
export function demoUrlFor(rootUrl: string): string {
  try {
    const url = new URL(rootUrl);
    // The root tenant's domain is stored bare, but a caller's URL need not be.
    url.hostname = `${DEMO_SUBDOMAIN}.${url.hostname.replace(/^www\./, '')}`;
    return url.origin;
  } catch {
    return '';
  }
}

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
   * Derived from this tenant's own URL. Safe to read as a plain computed: the
   * page only renders on the root tenant, whose URL *is* the deployment's, and
   * branding has resolved before any route is matched.
   */
  readonly demoUrl = computed(() => demoUrlFor(this.brandConfig.appUrl()));

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
