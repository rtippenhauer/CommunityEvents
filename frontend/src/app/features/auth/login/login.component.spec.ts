import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService, CurrentUser } from '../../../core/services/auth.service';

// An invite link lands here, so this page decides whether an invite is honoured
// or thrown away. The signed-in case is the one that broke: the browser already
// holds a session, which is not a reason to discard someone else's invite.
describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let authService: AuthService;
  let navigate: ReturnType<typeof vi.fn>;

  const member = (overrides: Partial<CurrentUser> = {}): CurrentUser => ({
    id: 1,
    fullName: 'Signed In Member',
    email: 'signed-in@example.test',
    role: 'member',
    status: 'active',
    cityId: 1,
    profilePhotoPath: null,
    ...overrides,
  });

  const renderWith = (token: string | null, signedInAs: CurrentUser | null): string => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
    });
    authService = TestBed.inject(AuthService);
    authService.currentUser.set(signedInAs);

    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  };

  beforeEach(async () => {
    navigate = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate, createUrlTree: () => ({}), serializeUrl: () => '' } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
  });

  it('sends a signed-in visitor with no invite to their profile, as before', () => {
    renderWith(null, member());

    expect(navigate).toHaveBeenCalledWith(['/profile']);
  });

  it('keeps the invite token when the browser is already signed in', () => {
    // The bug: the profile redirect ran before the token was ever read, so the
    // invite vanished with no error and no redemption. A private window worked,
    // which made it look like a broken link rather than a session collision.
    const text = renderWith('invite-token-abc', member());

    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.inviteToken()).toBe('invite-token-abc');
    expect(text).toContain('already signed in as signed-in@example.test');
  });

  it('offers to sign out and come back with the token intact', () => {
    renderWith('invite-token-abc', member());
    const logout = vi.spyOn(authService, 'logout').mockImplementation(() => {});

    fixture.componentInstance.signOutToAcceptInvite();

    expect(logout).toHaveBeenCalledWith({
      path: '/login',
      queryParams: { token: 'invite-token-abc' },
    });
  });

  it('shows the signup form to an anonymous visitor holding an invite', () => {
    const text = renderWith('invite-token-abc', null);

    expect(navigate).not.toHaveBeenCalled();
    expect(text).toContain('claim your seat at the table');
    expect(text).not.toContain('already signed in');
  });
});
