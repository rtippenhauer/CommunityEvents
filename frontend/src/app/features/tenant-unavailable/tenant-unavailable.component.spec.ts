import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TenantUnavailableComponent } from './tenant-unavailable.component';
import { TenantState } from '../../core/services/tenant-status.service';

// The holding page an unrecognized host gets instead of the app
// (REQ-TENANT-01.2). It has to stand on its own: there is no tenant, so there
// is no branding, no session and no config behind it.
describe('TenantUnavailableComponent', () => {
  let fixture: ComponentFixture<TenantUnavailableComponent>;

  const renderFor = (state: TenantState): string => {
    fixture = TestBed.createComponent(TenantUnavailableComponent);
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TenantUnavailableComponent],
    }).compileComponents();
  });

  it('welcomes the visitor to the project by name whatever went wrong', () => {
    // The one thing every version of this page says: an unrecognized host is
    // most likely a person who mistyped something, not an operator.
    for (const state of ['not-found', 'not-configured', 'suspended'] as TenantState[]) {
      expect(renderFor(state)).toContain('Welcome to Community Events');
    }
  });

  it('tells an unrecognized host that no community lives there', () => {
    const text = renderFor('not-found');

    expect(text).toContain("There's no community at this address yet.");
    expect(text).toContain('double-check the web address');
  });

  it('distinguishes an unfinished deployment from a wrong address', () => {
    // These two look identical to a visitor but mean opposite things to
    // whoever has to fix them.
    const text = renderFor('not-configured');

    expect(text).toContain('still being set up');
    expect(text).not.toContain('double-check the web address');
  });

  it('says a suspended community is temporary', () => {
    const text = renderFor('suspended');

    expect(text).toContain('temporarily unavailable');
    expect(text).toContain('check back later');
  });
});
