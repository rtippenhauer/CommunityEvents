import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

// Every request in the app passes through this, and it does two things that
// would be invisible if broken: attaches the session cookie, and turns a 401
// into a logout + redirect. Getting the /auth/me exemption wrong in particular
// would cause a redirect loop on boot.
describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // The JWT is a cookie, not a bearer header, so withCredentials is the entire
  // mechanism by which a request is authenticated at all.
  it('sends credentials on every request', () => {
    http.get('/api/v1/events').subscribe();
    const req = httpMock.expectOne('/api/v1/events');
    expect(req.request.withCredentials).toBe(true);
    req.flush([]);
  });

  describe('on 401', () => {
    it('clears the session and redirects to /login', () => {
      const navigate = spyOn(router, 'navigate');
      auth.currentUser.set({
        id: 1,
        fullName: 'Test',
        email: 't@example.test',
        role: 'member',
        status: 'active',
        cityId: 1,
        profilePhotoPath: null,
      });

      http.get('/api/v1/events').subscribe({ error: () => {} });
      httpMock
        .expectOne('/api/v1/events')
        .flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(auth.currentUser()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    // AuthService.init() probes /auth/me on boot and a 401 there is the normal
    // "not signed in" answer, not a session expiring. Redirecting on it would
    // bounce every anonymous visitor off whatever page they landed on.
    it('does NOT redirect when the 401 came from /auth/me', () => {
      const navigate = spyOn(router, 'navigate');

      http.get('/api/v1/auth/me').subscribe({ error: () => {} });
      httpMock
        .expectOne('/api/v1/auth/me')
        .flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(navigate).not.toHaveBeenCalled();
    });

    it('still propagates the error to the caller', () => {
      let status: number | undefined;
      http.get('/api/v1/events').subscribe({ error: (e) => (status = e.status) });
      httpMock
        .expectOne('/api/v1/events')
        .flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(status).toBe(401);
    });
  });

  describe('on other errors', () => {
    // Only 401 means "your session is gone". A 403 or 500 must not log the
    // member out — that would turn a permission error into a surprise logout.
    it('leaves the session alone on 403 and 500', () => {
      const navigate = spyOn(router, 'navigate');
      const user = {
        id: 1,
        fullName: 'Test',
        email: 't@example.test',
        role: 'member',
        status: 'active',
        cityId: 1,
        profilePhotoPath: null,
      };

      for (const status of [403, 500]) {
        auth.currentUser.set({ ...user });
        http.get(`/api/v1/thing-${status}`).subscribe({ error: () => {} });
        httpMock
          .expectOne(`/api/v1/thing-${status}`)
          .flush(null, { status, statusText: 'Err' });

        expect(auth.currentUser()).withContext(`status=${status}`).not.toBeNull();
      }
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
