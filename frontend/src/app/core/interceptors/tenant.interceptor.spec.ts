import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { tenantInterceptor } from './tenant.interceptor';
import { TenantStatusService } from '../services/tenant-status.service';

// This is what decides whether a visitor sees the app or the "not set up"
// holding page (REQ-TENANT-01.2). Two ways it could go wrong are both bad and
// both silent: never firing, so an unrecognized host shows a broken shell; or
// firing on ordinary API errors, so a single failed request blanks the site
// for a perfectly healthy tenant.
describe('tenantInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tenantStatus: TenantStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tenantInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    tenantStatus = TestBed.inject(TenantStatusService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const fail = (url: string, status: number, body: Record<string, unknown> | null): void => {
    http.get(url).subscribe({ error: () => {} });
    httpMock.expectOne(url).flush(body, { status, statusText: 'Err' });
  };

  it('assumes the tenant is fine until told otherwise', () => {
    expect(tenantStatus.state()).toBe('ok');
    expect(tenantStatus.unavailable()).toBe(false);
  });

  it('records an unrecognized host from a 404 TENANT_NOT_FOUND', () => {
    fail('/api/v1/config/branding', 404, { reason: 'TENANT_NOT_FOUND' });

    expect(tenantStatus.state()).toBe('not-found');
    expect(tenantStatus.unavailable()).toBe(true);
  });

  it('records an unbootstrapped deployment from a 503 TENANT_NOT_CONFIGURED', () => {
    fail('/api/v1/config/branding', 503, { reason: 'TENANT_NOT_CONFIGURED' });

    expect(tenantStatus.state()).toBe('not-configured');
  });

  it('records a suspended tenant from a 503 TENANT_SUSPENDED', () => {
    fail('/api/v1/config/branding', 503, { reason: 'TENANT_SUSPENDED' });

    expect(tenantStatus.state()).toBe('suspended');
  });

  describe('errors that are not about the tenant', () => {
    // An ordinary 404 for a missing record, a 401, a 500 — none of these mean
    // the site does not exist, and treating them as such would replace the
    // whole app with a holding page over one bad request.
    it('ignores a plain 404 with no reason', () => {
      fail('/api/v1/events/999', 404, { message: 'Not Found' });

      expect(tenantStatus.state()).toBe('ok');
    });

    it('ignores a 404 whose reason is something else', () => {
      fail('/api/v1/events/999', 404, { reason: 'EVENT_NOT_FOUND' });

      expect(tenantStatus.state()).toBe('ok');
    });

    it('ignores a 500 with no body at all', () => {
      fail('/api/v1/events', 500, null);

      expect(tenantStatus.state()).toBe('ok');
    });

    it('ignores a non-string reason', () => {
      fail('/api/v1/events', 404, { reason: { nested: 'TENANT_NOT_FOUND' } });

      expect(tenantStatus.state()).toBe('ok');
    });
  });

  it('still propagates the error to the caller', () => {
    // This interceptor only observes; a caller that handles its own errors
    // must keep seeing them.
    let status: number | undefined;
    http.get('/api/v1/config/branding').subscribe({ error: (e) => (status = e.status) });
    httpMock
      .expectOne('/api/v1/config/branding')
      .flush({ reason: 'TENANT_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });

    expect(status).toBe(404);
  });

  it('stays unavailable once it has seen a tenant failure', () => {
    // On a dead tenant the follow-up requests fail in assorted unrelated ways.
    // Letting one of those clear the flag would flip the user back to a
    // half-broken shell after the holding page had already rendered.
    fail('/api/v1/config/branding', 404, { reason: 'TENANT_NOT_FOUND' });
    fail('/api/v1/auth/me', 401, { message: 'Unauthorized' });

    expect(tenantStatus.state()).toBe('not-found');
  });

  it('does not fire on a successful response', () => {
    http.get('/api/v1/config/branding').subscribe();
    httpMock.expectOne('/api/v1/config/branding').flush({ name: 'Test' });

    expect(tenantStatus.state()).toBe('ok');
  });
});
