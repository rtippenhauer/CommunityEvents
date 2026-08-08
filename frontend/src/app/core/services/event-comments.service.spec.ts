import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { EventCommentsService, Comment, CommentReply } from './event-comments.service';

// Typed HTTP service — components never touch HttpClient directly, so these
// methods are the single place a wrong URL or verb would slip through. The
// edit endpoints (Phase 36) matter most: they are PATCH, and a stray POST
// would create a duplicate comment rather than editing one.
describe('EventCommentsService', () => {
  let service: EventCommentsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EventCommentsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EventCommentsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('reading', () => {
    it('GETs the comment list for an event', () => {
      let received: Comment[] | undefined;
      service.getComments(7).subscribe((c) => (received = c));

      const req = httpMock.expectOne('/api/v1/events/7/comments');
      expect(req.request.method).toBe('GET');
      req.flush([]);

      expect(received).toEqual([]);
    });
  });

  describe('creating', () => {
    it('POSTs a new comment with the body in the payload', () => {
      service.addComment(7, 'Excited for this one').subscribe();

      const req = httpMock.expectOne('/api/v1/events/7/comments');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ body: 'Excited for this one' });
      req.flush({});
    });

    it('POSTs a reply under its parent comment', () => {
      service.addReply(7, 42, 'Agreed').subscribe();

      const req = httpMock.expectOne('/api/v1/events/7/comments/42/replies');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ body: 'Agreed' });
      req.flush({});
    });
  });

  describe('editing (Phase 36)', () => {
    it('PATCHes a comment — not POST, which would duplicate it', () => {
      let updated: Comment | undefined;
      service.editComment(7, 42, 'Revised text').subscribe((c) => (updated = c));

      const req = httpMock.expectOne('/api/v1/events/7/comments/42');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ body: 'Revised text' });

      req.flush({ id: 42, body: 'Revised text', editedAt: '2026-08-08T00:00:00.000Z' });

      expect(updated?.body).toBe('Revised text');
      // editedAt is what drives the "(edited)" marker — it must survive the
      // round trip, or an edit silently looks like an original post.
      expect(updated?.editedAt).toBe('2026-08-08T00:00:00.000Z');
    });

    it('PATCHes a reply at its nested route', () => {
      let updated: CommentReply | undefined;
      service.editReply(7, 42, 99, 'Revised reply').subscribe((r) => (updated = r));

      const req = httpMock.expectOne('/api/v1/events/7/comments/42/replies/99');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ body: 'Revised reply' });

      req.flush({ id: 99, body: 'Revised reply', editedAt: '2026-08-08T00:00:00.000Z' });

      expect(updated?.body).toBe('Revised reply');
      expect(updated?.editedAt).toBe('2026-08-08T00:00:00.000Z');
    });
  });

  describe('deleting', () => {
    it('DELETEs a comment', () => {
      service.deleteComment(7, 42).subscribe();
      const req = httpMock.expectOne('/api/v1/events/7/comments/42');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('DELETEs a reply at its nested route', () => {
      service.deleteReply(7, 42, 99).subscribe();
      const req = httpMock.expectOne('/api/v1/events/7/comments/42/replies/99');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('member search', () => {
    // excludeGoing is sent as a string query param; a boolean would serialize
    // fine but the API reads it as a string, so pin the shape.
    it('passes the query and excludeGoing flag as params', () => {
      service.searchMembers(7, 'ali', false).subscribe();

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/events/7/members/search',
      );
      expect(req.request.params.get('q')).toBe('ali');
      expect(req.request.params.get('excludeGoing')).toBe('false');
      req.flush([]);
    });

    it('defaults excludeGoing to true', () => {
      service.searchMembers(7, 'ali').subscribe();

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/events/7/members/search',
      );
      expect(req.request.params.get('excludeGoing')).toBe('true');
      req.flush([]);
    });
  });
});
