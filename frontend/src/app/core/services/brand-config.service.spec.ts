import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { BrandConfigService, BrandConfig } from './brand-config.service';
import { contrastRatio, AA_NORMAL } from '../utils/color.util';

// First frontend spec in the project. Targets BrandConfigService because it is
// the highest-leverage pure logic in the app: every nav item, route guard and
// terminology label reads these signals, and its fallback values are what the
// whole UI runs on whenever /config/branding is slow or fails.
describe('BrandConfigService', () => {
  let service: BrandConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BrandConfigService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BrandConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('fallback defaults (before /config/branding resolves)', () => {
    // Features default ON so a slow or failed fetch never hides a feature that
    // is actually enabled.
    it('enables ratings, leaderboard, merch and members by default', () => {
      expect(service.ratingsEnabled()).toBe(true);
      expect(service.leaderboardEnabled()).toBe(true);
      expect(service.merchEnabled()).toBe(true);
      expect(service.membersEnabled()).toBe(true);
    });

    // Two deliberate exceptions that must fail CLOSED. requireMembership must
    // never start enforcing on a failed fetch; ratingsResidences (Phase 37)
    // must not render a rating form the API answers with a 403.
    it('disables residence ratings and membership enforcement by default', () => {
      expect(service.ratingsResidencesEnabled()).toBe(false);
      expect(service.requireMembershipEnabled()).toBe(false);
    });
  });

  describe('terminology', () => {
    it('derives lowercase variants for mid-sentence copy', () => {
      service.brand.update((b) => ({
        ...b,
        terms: {
          locationSingular: 'Venue',
          locationPlural: 'Venues',
          dinnerSingular: 'Meeting',
          dinnerPlural: 'Meetings',
          points: 'Credits',
        },
      }));

      expect(service.locationSingular()).toBe('Venue');
      expect(service.locationSingularLower()).toBe('venue');
      expect(service.locationPluralLower()).toBe('venues');
      expect(service.dinnerSingularLower()).toBe('meeting');
      expect(service.dinnerPluralLower()).toBe('meetings');
      expect(service.points()).toBe('Credits');
    });
  });

  describe('foundingLabel', () => {
    // Served per community as of v2-10, read from that community's own
    // achievement row. It used to be derived by comparing brand_name against
    // the literal 'dinnerbears', which was a guess standing in for data that
    // did not exist while the catalogue was global.
    it('reports whatever this community calls its founding badge', () => {
      service.brand.update((b) => ({ ...b, foundingLabel: 'Founding Bear' }));
      expect(service.foundingLabel()).toBe('Founding Bear');

      service.brand.update((b) => ({ ...b, foundingLabel: 'Charter Member' }));
      expect(service.foundingLabel()).toBe('Charter Member');
    });

    it('does not derive the label from the brand name', () => {
      // The old rule returned "Founding Bear" for this name alone.
      service.brand.update((b) => ({
        ...b,
        name: 'DinnerBears',
        foundingLabel: 'Founding Member',
      }));
      expect(service.foundingLabel()).toBe('Founding Member');
    });
  });

  describe('init()', () => {
    it('fetches /config/branding and exposes the served values as signals', async () => {
      const pending = service.init();

      const req = httpMock.expectOne('/api/v1/config/branding');
      expect(req.request.method).toBe('GET');

      req.flush({
        ...service.brand(),
        name: 'Sons',
        tagline: 'A different group',
        baseDomain: 'sons.example.com',
        isStage: true,
        features: {
          ratings: true,
          ratingsResidences: false,
          leaderboard: false,
          merch: false,
          members: true,
          requireMembership: true,
        },
      } as BrandConfig);

      await pending;

      expect(service.brand().name).toBe('Sons');
      expect(service.baseDomain()).toBe('sons.example.com');
      expect(service.isStage()).toBe(true);
      expect(service.leaderboardEnabled()).toBe(false);
      expect(service.requireMembershipEnabled()).toBe(true);
      expect(service.foundingLabel()).toBe('Founding Member');
    });

    // The tab title is set from branding at boot, with a "(Stage)" suffix so a
    // stage tab stays distinguishable from prod — there is no separate stage
    // build or index.html to tell them apart any more.
    it('suffixes the tab title on a stage instance', async () => {
      const pending = service.init();
      httpMock
        .expectOne('/api/v1/config/branding')
        .flush({ ...service.brand(), name: 'Sons', isStage: true } as BrandConfig);
      await pending;

      expect(TestBed.inject(Title).getTitle()).toBe('Sons (Stage)');
    });

    it('leaves the tab title unsuffixed on a prod instance', async () => {
      const pending = service.init();
      httpMock
        .expectOne('/api/v1/config/branding')
        .flush({ ...service.brand(), name: 'Sons', isStage: false } as BrandConfig);
      await pending;

      expect(TestBed.inject(Title).getTitle()).toBe('Sons');
    });

    // A failed fetch must leave the app usable on defaults rather than throw
    // and take down bootstrap with it.
    it('falls back to defaults without rejecting when the request fails', async () => {
      const pending = service.init();

      httpMock
        .expectOne('/api/v1/config/branding')
        .flush('boom', { status: 500, statusText: 'Server Error' });

      // Jasmine's expectAsync(...).toBeResolved(); the point is that init()
      // settles rather than rejecting when the branding request fails.
      await expect(pending).resolves.toBeUndefined();

      expect(service.ratingsEnabled()).toBe(true);
      expect(service.ratingsResidencesEnabled()).toBe(false);
    });
  });

  // v2-11. The on- colours used to be pinned to white, which is a defect an
  // admin can see and cannot fix: the on-colour was never a setting. These
  // assert the measurement, not a particular hex, so re-tuning the derivation
  // cannot quietly reintroduce an unreadable pair.
  describe('applied colours', () => {
    const applied = (token: string): string =>
      document.documentElement.style.getPropertyValue(token).trim();

    const load = async (colors: Partial<BrandConfig>): Promise<void> => {
      const pending = service.init();
      httpMock
        .expectOne('/api/v1/config/branding')
        .flush({ ...service.brand(), ...colors } as BrandConfig);
      await pending;
    };

    it('gives a light primary dark text rather than white', async () => {
      // The case that motivated the item: white on a pale button.
      await load({ colorPrimary: '#f2d98c', colorAccent: '#f2d98c', colorBackground: '#ffffff' });

      expect(contrastRatio(applied('--db-on-primary'), '#f2d98c')!).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
      expect(applied('--mat-sys-on-primary')).toBe(applied('--db-on-primary'));
    });

    it('gives a dark primary white text', async () => {
      await load({ colorPrimary: '#123456', colorAccent: '#123456', colorBackground: '#ffffff' });

      expect(applied('--db-on-primary')).toBe('#ffffff');
      expect(contrastRatio(applied('--db-on-primary'), '#123456')!).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    });

    it('keeps body ink legible on a dark page background', async () => {
      // applyChrome prefers a warm brand-tinted ink, which on a dark ground is
      // exactly the preference that has to give way.
      await load({ colorPrimary: '#C9933A', colorAccent: '#C9933A', colorBackground: '#1b1205' });

      expect(contrastRatio(applied('--db-text-dark'), '#1b1205')!).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
      expect(contrastRatio(applied('--db-text-mid'), '#1b1205')!).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    });

    it('keeps the warm brand ink when the background allows it', async () => {
      // The other half of readableOn: measurement is the floor, not the rule.
      await load({ colorPrimary: '#C9933A', colorAccent: '#C9933A', colorBackground: '#FDFAF5' });

      expect(applied('--db-text-dark')).not.toBe('#000000');
      expect(contrastRatio(applied('--db-text-dark'), '#FDFAF5')!).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    });
  });
});
