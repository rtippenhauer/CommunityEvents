import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AnnouncementsService, AnnouncementComment } from './announcements.service';

// Announcement comments share the member-facing behavior of event comments but
// live on a different route shape: comment routes hang off /announcements
// directly, NOT off /announcements/:id — an easy thing to get wrong, and the
// kind of mistake that only shows up at runtime as a 404.
describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AnnouncementsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnnouncementsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('listing', () => {
    it('GETs all announcements with no params when no city is given', () => {
      service.getAll().subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/v1/announcements');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('cityId')).toBe(false);
      req.flush([]);
    });

    it('passes cityId as a param when scoping to a city', () => {
      service.getAll(3).subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/v1/announcements');
      expect(req.request.params.get('cityId')).toBe('3');
      req.flush([]);
    });
  });

  describe('comments', () => {
    it('POSTs a new comment under the announcement', () => {
      service.addComment(5, 'Nice').subscribe();
      const req = httpMock.expectOne('/api/v1/announcements/5/comments');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ body: 'Nice' });
      req.flush({});
    });

    // Phase 36. Note the route: /announcements/comments/:id, with no
    // announcement id — it does not nest under the announcement the way
    // creating one does.
    it('PATCHes an edit at the un-nested comment route', () => {
      let updated: AnnouncementComment | undefined;
      service.editComment(88, 'Reworded').subscribe((c) => (updated = c));

      const req = httpMock.expectOne('/api/v1/announcements/comments/88');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ body: 'Reworded' });

      req.flush({ id: 88, body: 'Reworded', editedAt: '2026-08-08T00:00:00.000Z' });

      expect(updated?.body).toBe('Reworded');
      expect(updated?.editedAt).toBe('2026-08-08T00:00:00.000Z');
    });

    it('DELETEs at the same un-nested comment route', () => {
      service.deleteComment(88).subscribe();
      const req = httpMock.expectOne('/api/v1/announcements/comments/88');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('flagging', () => {
    it('POSTs the content type, id and reason', () => {
      service.flagContent('announcement_comment', 88, 'spam').subscribe();
      const req = httpMock.expectOne('/api/v1/announcements/flag');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        contentType: 'announcement_comment',
        contentId: 88,
        reason: 'spam',
      });
      req.flush(null);
    });
  });

  describe('admin routes', () => {
    // Admin calls must hit /admin/announcements. Hitting the public base would
    // silently return only published rows instead of drafts.
    it('uses the admin base for listing and creating', () => {
      service.adminGetAll().subscribe();
      expect(httpMock.expectOne('/api/v1/admin/announcements').request.method).toBe('GET');
      httpMock.verify();

      service.adminCreate({ title: 'T', body: 'B', cityId: null }).subscribe();
      const create = httpMock.expectOne('/api/v1/admin/announcements');
      expect(create.request.method).toBe('POST');
      expect(create.request.body).toEqual({ title: 'T', body: 'B', cityId: null });
      create.flush({});
    });

    it('publishes via a dedicated POST sub-route', () => {
      service.adminPublish(5).subscribe();
      const req = httpMock.expectOne('/api/v1/admin/announcements/5/publish');
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });
});
