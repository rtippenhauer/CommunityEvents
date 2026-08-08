import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { EventsService } from './events.service';
import { RsvpStatus } from './events.service';

// The largest domain surface in the app. The RSVP payload matters most:
// Phase 35 added bringingItem and guest counts ride along with it, so a
// dropped field means a member's potluck note or guest count silently
// vanishes at the venue.
describe('EventsService', () => {
  let service: EventsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EventsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EventsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('listing', () => {
    it('sends no params when unfiltered', () => {
      service.getAll().subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events'));
      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('passes cityId, status and upcoming through as params', () => {
      service.getAll({ cityId: 2, upcoming: true, status: 'published' as never }).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events'));
      expect(req.request.params.get('cityId')).toBe('2');
      expect(req.request.params.get('upcoming')).toBe('true');
      expect(req.request.params.get('status')).toBe('published');
      req.flush([]);
    });

    // fromDate and upcoming are mutually exclusive by design (an `else if`):
    // an explicit date wins and `upcoming` is dropped, so the two can never
    // contradict each other in one query.
    it('drops upcoming when an explicit fromDate is given', () => {
      service.getAll({ upcoming: true, fromDate: '2027-01-01' }).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events'));
      expect(req.request.params.get('fromDate')).toBe('2027-01-01');
      expect(req.request.params.has('upcoming')).toBe(false);
      req.flush([]);
    });

    it('sends upcoming=false explicitly rather than omitting it', () => {
      service.getAll({ upcoming: false }).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events'));
      expect(req.request.params.get('upcoming')).toBe('false');
      req.flush([]);
    });
  });

  describe('rsvp', () => {
    it('POSTs status and guest count', () => {
      service.rsvp(9, 'going' as RsvpStatus, 2).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events/9/rsvp'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body.status).toBe('going');
      expect(req.request.body.additionalGuests).toBe(2);
      req.flush({});
    });

    it('carries guest names and the Phase 35 bringing item', () => {
      service.rsvp(9, 'going' as RsvpStatus, 2, ['Ann', 'Bob'], 'potato salad').subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events/9/rsvp'));
      expect(req.request.body).toEqual({
        status: 'going',
        additionalGuests: 2,
        guestNames: ['Ann', 'Bob'],
        bringingItem: 'potato salad',
      });
      req.flush({});
    });

    // Cancelling is DELETE on the same route — not a POST with status
    // 'not_going', which would leave the member counted at the venue.
    it('cancels with DELETE on the same rsvp route', () => {
      service.unrsvp(9).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events/9/rsvp'));
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('guest links', () => {
    it('generates a link with optional recipient details', () => {
      service.generateGuestLink(9, 'Ann', 'ann@example.test').subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events/9/rsvp/link'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        recipientName: 'Ann',
        recipientEmail: 'ann@example.test',
      });
      req.flush({});
    });

    // Token routes are public — they must NOT be nested under an event id,
    // since an unauthenticated recipient has no way to know one.
    it('resolves a guest link by token alone', () => {
      service.getGuestLinkInfo('tok123').subscribe();
      const req = httpMock.expectOne((r) => r.url.includes('tok123'));
      expect(req.request.method).toBe('GET');
      expect(req.request.url).not.toContain('/events/9/');
      req.flush({});
    });

    it('confirms a guest RSVP by token', () => {
      service.confirmGuestRsvp('tok123', 'Ann').subscribe();
      const req = httpMock.expectOne((r) => r.url.includes('tok123') && r.method === 'POST');
      expect(req.request.body).toEqual({ guestName: 'Ann' });
      req.flush({ message: 'ok' });
    });
  });

  describe('lifecycle', () => {
    it('updates with PATCH, not PUT', () => {
      service.update(9, { title: 'New' } as never).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events/9'));
      expect(req.request.method).toBe('PATCH');
      req.flush({});
    });

    it('deletes with DELETE', () => {
      service.delete(9).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/events/9'));
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
