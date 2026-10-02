import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { LandingComponent } from './landing.component';
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

  // Both CTAs send the visitor to the in-app demo request page (v2-14). They
  // used to be external links to a fixed `demo.` host; demos have generated
  // hosts now and none of them exists until somebody asks for one.
  it('points every call to action at the demo request page', () => {
    setup();
    const links: HTMLAnchorElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('a[href]'),
    );
    const ctas = links.filter((link) => link.classList.contains('cta'));

    expect(ctas.length).toBe(2);
    for (const cta of ctas) {
      expect(cta.getAttribute('href')).toBe('/demo');
    }
  });

  // The page must not promise anything the demo does not do. It is deleted
  // within the week, and saying so on the front door rather than only after
  // signup is the difference between a warning and an excuse.
  it('says on the front door that a demo is temporary', () => {
    setup();
    expect(fixture.nativeElement.textContent).toContain('yours for a week');
  });
});
