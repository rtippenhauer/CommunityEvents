import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { LandingComponent, demoUrlFor } from './landing.component';
import { BrandConfigService } from '../../core/services/brand-config.service';

describe('LandingComponent', () => {
  let fixture: ComponentFixture<LandingComponent>;

  function setup(brandName = 'CommunityEvents', appUrl = 'https://communityeventsproject.com') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        {
          provide: BrandConfigService,
          useValue: { brand: signal({ name: brandName }), appUrl: () => appUrl },
        },
      ],
    });
    fixture = TestBed.createComponent(LandingComponent);
    fixture.detectChanges();
  }

  it('renders the marketing copy', () => {
    setup();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Group events that actually happen.');
    expect(text).toContain('What a community gets');
  });

  // The name is the operator's, read from branding, not a compiled-in
  // "CommunityEvents" — a deployment that renamed itself would otherwise be
  // contradicted by its own front door.
  it('wears the root tenant configured name', () => {
    setup('Dayton Community Events');
    expect(fixture.nativeElement.textContent).toContain('Dayton Community Events');
  });

  // Both CTAs are the demo, and both must be the same address: a landing page
  // whose two buttons disagree sends half its visitors somewhere that is not
  // the demo.
  it('points every call to action at the demo', () => {
    setup();
    const links: HTMLAnchorElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('a[href^="http"]'),
    );
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('https://demo.communityeventsproject.com');
    }
  });

  // The demo lives on whichever deployment is serving this page, which is what
  // keeps it a *subdomain* of the deployment domain and so able to inherit the
  // deployment's Brevo and Google credentials.
  it('derives the demo from the deployment actually serving the page', () => {
    setup('CommunityEvents', 'https://stage.communityeventsproject.com');
    const link = fixture.nativeElement.querySelector('a[href^="http"]');
    expect(link.getAttribute('href')).toBe('https://demo.stage.communityeventsproject.com');
  });

  // Rendering `href=""` would be a button that silently reloads the page.
  it('hides the call to action rather than linking nowhere', () => {
    setup('CommunityEvents', '');
    expect(fixture.nativeElement.querySelectorAll('a[href^="http"]').length).toBe(0);
    // The page itself still renders — only the link is withheld.
    expect(fixture.nativeElement.textContent).toContain('What a community gets');
  });

  it('renders every feature card', () => {
    setup();
    const cards = fixture.nativeElement.querySelectorAll('.feature');
    expect(cards.length).toBe(6);
  });

  describe('demoUrlFor', () => {
    it('puts the demo on a subdomain of the deployment domain', () => {
      expect(demoUrlFor('https://communityeventsproject.com')).toBe(
        'https://demo.communityeventsproject.com',
      );
      expect(demoUrlFor('https://stage.communityeventsproject.com')).toBe(
        'https://demo.stage.communityeventsproject.com',
      );
    });

    // The root tenant's domain is stored bare, but nothing guarantees a caller
    // hands one over that way -- and `demo.www.x` is a host nobody registered.
    it('does not build the demo under a www. host', () => {
      expect(demoUrlFor('https://www.communityeventsproject.com')).toBe(
        'https://demo.communityeventsproject.com',
      );
    });

    it('keeps the scheme and port of the deployment it is derived from', () => {
      expect(demoUrlFor('http://localhost:8081')).toBe('http://demo.localhost:8081');
    });

    it('returns nothing for a URL it cannot parse', () => {
      expect(demoUrlFor('')).toBe('');
      expect(demoUrlFor('not a url')).toBe('');
    });
  });
});
