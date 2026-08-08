import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { LocationDetailComponent } from './location-detail.component';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { AuthService } from '../../../core/services/auth.service';

// The Phase 37 gate. This is the piece that was only ever confirmed by looking
// at stage by hand — everything else about residence ratings is covered
// server-side. Pinning it here means the UI half stops depending on someone
// remembering to check.
describe('LocationDetailComponent — rating visibility', () => {
  function createComponent(options: {
    ratings: boolean;
    ratingsResidences: boolean;
    isResidence: boolean;
  }) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LocationDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => '1' } }, params: of({ id: '1' }) },
        },
        {
          provide: BrandConfigService,
          useValue: {
            ratingsEnabled: () => options.ratings,
            ratingsResidencesEnabled: () => options.ratingsResidences,
            locationSingular: () => 'Restaurant',
            locationPlural: () => 'Restaurants',
            locationSingularLower: () => 'restaurant',
            locationPluralLower: () => 'restaurants',
            dinnerSingular: () => 'Dinner',
            dinnerPlural: () => 'Dinners',
            dinnerSingularLower: () => 'dinner',
            dinnerPluralLower: () => 'dinners',
            points: () => 'Points',
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({ id: 1, role: 'member' }),
            isLoggedIn: () => true,
            isNonValidated: () => false,
          },
        },
      ],
    });

    // Instantiate without running ngOnInit — the gate is a pure computed over
    // the location signal and the brand flags, so no data loading is needed.
    const component = TestBed.createComponent(LocationDetailComponent).componentInstance;
    component.location.set({
      id: 1,
      name: options.isResidence ? "Someone's House" : 'A Restaurant',
      isResidence: options.isResidence,
      isPrivate: false,
      address: '1 Main St',
    } as never);
    return component;
  }

  it('shows ratings for a normal restaurant', () => {
    const c = createComponent({ ratings: true, ratingsResidences: false, isResidence: false });
    expect(c.showRatings()).toBe(true);
  });

  // The Phase 37 default: residences are not rateable.
  it('hides ratings for a residence when residence ratings are off', () => {
    const c = createComponent({ ratings: true, ratingsResidences: false, isResidence: true });
    expect(c.showRatings()).toBe(false);
  });

  // Still admin-overridable per instance — the toggle was not removed.
  it('shows ratings for a residence once an admin re-enables them', () => {
    const c = createComponent({ ratings: true, ratingsResidences: true, isResidence: true });
    expect(c.showRatings()).toBe(true);
  });

  // The residence rule is a sub-rule: turning ratings off globally must hide
  // them everywhere, residence or not.
  it('hides ratings everywhere when the ratings feature is off entirely', () => {
    const restaurant = createComponent({
      ratings: false,
      ratingsResidences: true,
      isResidence: false,
    });
    expect(restaurant.showRatings()).toBe(false);

    const residence = createComponent({
      ratings: false,
      ratingsResidences: true,
      isResidence: true,
    });
    expect(residence.showRatings()).toBe(false);
  });

  it('hides ratings before the location has loaded', () => {
    const c = createComponent({ ratings: true, ratingsResidences: true, isResidence: false });
    c.location.set(null);
    expect(c.showRatings()).toBe(false);
  });
});
