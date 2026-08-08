import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { LocationsService } from './locations.service';

// Locations carry the ratings endpoints Phase 37 changed, plus the archive /
// restore pair where a wrong verb would be destructive rather than merely
// broken.
describe('LocationsService', () => {
  let service: LocationsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LocationsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LocationsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('listing', () => {
    it('GETs the list with no params when unfiltered', () => {
      service.getAll().subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations'));
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('passes cityId and search as params', () => {
      service.getAll(2, 'thai').subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations'));
      expect(req.request.params.get('cityId')).toBe('2');
      expect(req.request.params.get('search')).toBe('thai');
      req.flush([]);
    });

    // Archived listing is a separate route, not a flag on the main one —
    // mixing them up would silently show deleted venues to members.
    it('reads archived locations from their own route', () => {
      service.getArchived().subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/archived'));
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('lifecycle', () => {
    it('soft-deletes with DELETE', () => {
      service.delete(5).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/5'));
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    // Restore is PATCH on a dedicated sub-route. A DELETE here would archive
    // the thing the admin was trying to bring back.
    it('restores with PATCH on the restore sub-route', () => {
      service.restore(5).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/5/restore'));
      expect(req.request.method).toBe('PATCH');
      req.flush({});
    });
  });

  describe('ratings (Phase 37 surface)', () => {
    it('GETs ratings for a location', () => {
      service.getRatings(5).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/5/ratings'));
      expect(req.request.method).toBe('GET');
      req.flush({ aggregate: {}, reviews: [], eligibleEvents: [] });
    });

    it('POSTs a rating with the full payload', () => {
      service
        .submitRating(5, { eventId: 9, food: 5, service: 4, valueRating: 3, noise: 2 })
        .subscribe();

      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/5/ratings'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        eventId: 9,
        food: 5,
        service: 4,
        valueRating: 3,
        noise: 2,
      });
      req.flush({});
    });

    // The queue is member-scoped and hangs off /locations, not off a
    // particular location id.
    it('reads the rating queue from its own collection route', () => {
      service.getRatingQueue().subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/rating-queue'));
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('photos', () => {
    it('uploads a photo as multipart form data', () => {
      const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
      service.addPhoto(5, file).subscribe();

      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/5/photos'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush({});
    });

    it('deletes a photo by its own id', () => {
      service.deletePhoto(5, 77).subscribe();
      const req = httpMock.expectOne((r) => r.url.endsWith('/locations/5/photos/77'));
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
