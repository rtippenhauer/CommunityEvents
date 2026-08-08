import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, CurrentUser } from './auth.service';

// The role/session predicates every guard and half the templates branch on.
// Small surface, but a wrong answer here decides what a member can see.
describe('AuthService', () => {
  let service: AuthService;

  const user = (overrides: Partial<CurrentUser> = {}): CurrentUser => ({
    id: 1,
    fullName: 'Test Member',
    email: 'member@example.test',
    role: 'member',
    status: 'active',
    cityId: 1,
    profilePhotoPath: null,
    ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
  });

  describe('isLoggedIn', () => {
    it('is false before any user is set', () => {
      expect(service.isLoggedIn()).toBe(false);
    });

    it('is true once a user is present', () => {
      service.currentUser.set(user());
      expect(service.isLoggedIn()).toBe(true);
    });
  });

  describe('isNonValidated', () => {
    // Anonymous is not the same as non-validated — an anonymous visitor has no
    // account at all, so this must be false rather than defaulting true and
    // shunting them down the non-validated path.
    it('is false for an anonymous visitor', () => {
      expect(service.isNonValidated()).toBe(false);
    });

    it('is true only for the non_validated role', () => {
      service.currentUser.set(user({ role: 'non_validated' }));
      expect(service.isNonValidated()).toBe(true);

      for (const role of ['member', 'moderator', 'admin']) {
        service.currentUser.set(user({ role }));
        expect(service.isNonValidated())
          .withContext(`role=${role}`)
          .toBe(false);
      }
    });
  });

  describe('updatePhoto', () => {
    it('replaces the photo path on the current user', () => {
      service.currentUser.set(user({ profilePhotoPath: 'old.jpg' }));
      service.updatePhoto('new.jpg');
      expect(service.currentUser()?.profilePhotoPath).toBe('new.jpg');
    });

    it('supports clearing back to a preset avatar', () => {
      service.currentUser.set(user({ profilePhotoPath: 'old.jpg' }));
      service.updatePhoto(null);
      expect(service.currentUser()?.profilePhotoPath).toBeNull();
    });

    // Must not resurrect a user object out of nothing when logged out.
    it('stays null when nobody is signed in', () => {
      service.updatePhoto('new.jpg');
      expect(service.currentUser()).toBeNull();
    });

    it('leaves the rest of the user untouched', () => {
      service.currentUser.set(user({ fullName: 'Alice', role: 'admin' }));
      service.updatePhoto('new.jpg');
      expect(service.currentUser()?.fullName).toBe('Alice');
      expect(service.currentUser()?.role).toBe('admin');
    });
  });
});
