import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { LandingComponent, DEMO_URL } from './landing.component';
import { BrandConfigService } from '../../core/services/brand-config.service';

describe('LandingComponent', () => {
  let fixture: ComponentFixture<LandingComponent>;

  function setup(brandName = 'CommunityEvents') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        { provide: BrandConfigService, useValue: { brand: signal({ name: brandName }) } },
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
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(DEMO_URL);
    }
  });

  it('renders every feature card', () => {
    setup();
    const cards = fixture.nativeElement.querySelectorAll('.feature');
    expect(cards.length).toBe(6);
  });
});
