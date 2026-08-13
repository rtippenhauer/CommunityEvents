import type { MockedFunction } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import { TenantMiddleware } from './tenant.middleware';
import { TenantResolutionService, TenantResolution } from './tenant-resolution.service';

/**
 * The middleware turns a resolution outcome into an HTTP answer
 * (REQ-TENANT-01.2). Resolution itself is covered by
 * tenant-resolution.service.spec.ts; what is asserted here is the mapping --
 * which status code, which `reason`, and whether the request continues.
 *
 * The `reason` strings are load-bearing: the frontend reads them to decide
 * between the holding page and an ordinary error, so they are asserted
 * literally rather than through a helper.
 */
describe('TenantMiddleware', () => {
  const tenant = {
    id: 1,
    slug: 'root',
    domain: 'communityeventsproject.com',
    isRoot: true,
    status: 'active' as const,
  };

  let resolve: ReturnType<typeof vi.fn>;
  let next: MockedFunction<NextFunction>;
  let json: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof vi.fn>;

  const makeMiddleware = (resolution: TenantResolution) => {
    resolve = vi.fn(async () => resolution);
    return new TenantMiddleware({ resolve } as unknown as TenantResolutionService);
  };

  // `path` and `url` are deliberately '/' rather than the requested path.
  // That is what Express hands a mounted middleware -- it strips the mount
  // path -- and the middleware has to read originalUrl instead. Building the
  // fake request the "obvious" way hid a real bug where the health exemption
  // matched nothing.
  const makeReq = (path: string, host = 'communityeventsproject.com') =>
    ({ path: '/', url: '/', originalUrl: path, headers: { host } }) as unknown as Request;

  const makeRes = () => {
    json = vi.fn();
    status = vi.fn(() => ({ json }));
    return { status } as unknown as Response;
  };

  beforeEach(() => {
    next = vi.fn() as MockedFunction<NextFunction>;
  });

  describe('a resolved tenant', () => {
    it('attaches it to the request and continues', async () => {
      const middleware = makeMiddleware({ outcome: 'resolved', tenant });
      const req = makeReq('/api/v1/events');

      await middleware.use(req, makeRes(), next);

      expect(req.tenant).toEqual(tenant);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('resolves using the Host header', async () => {
      const middleware = makeMiddleware({ outcome: 'resolved', tenant });

      await middleware.use(makeReq('/api/v1/events', 'www.communityeventsproject.com'), makeRes(), next);

      expect(resolve).toHaveBeenCalledWith('www.communityeventsproject.com');
    });
  });

  describe('an unrecognized host', () => {
    it('answers 404 with a TENANT_NOT_FOUND reason and stops the request', async () => {
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/events'), makeRes(), next);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404, reason: 'TENANT_NOT_FOUND' }),
      );
      // The handler must never run: a request with no tenant has no business
      // reaching code that assumes one.
      expect(next).not.toHaveBeenCalled();
    });

    it('does not leak whether the path exists', async () => {
      // A real route and a nonsense one must be indistinguishable from an
      // unrecognized host, or the 404 becomes a path oracle.
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/events'), makeRes(), next);
      const real = json.mock.calls[0][0];
      await middleware.use(makeReq('/api/v1/no-such-route'), makeRes(), next);
      const fake = json.mock.calls[0][0];

      expect(fake.statusCode).toBe(real.statusCode);
      expect(fake.message).toBe(real.message);
      expect(fake.reason).toBe(real.reason);
    });
  });

  describe('a deployment with no tenants', () => {
    it('answers 503 with a TENANT_NOT_CONFIGURED reason, not 404', async () => {
      // 404 would blame the caller for the operator's unfinished install.
      const middleware = makeMiddleware({ outcome: 'not-configured' });

      await middleware.use(makeReq('/api/v1/events'), makeRes(), next);

      expect(status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503, reason: 'TENANT_NOT_CONFIGURED' }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('a suspended tenant', () => {
    it('answers 503 with a TENANT_SUSPENDED reason', async () => {
      const middleware = makeMiddleware({ outcome: 'suspended', tenant });

      await middleware.use(makeReq('/api/v1/events'), makeRes(), next);

      expect(status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503, reason: 'TENANT_SUSPENDED' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('does not attach the tenant, so nothing downstream serves its data', async () => {
      const middleware = makeMiddleware({ outcome: 'suspended', tenant });
      const req = makeReq('/api/v1/events');

      await middleware.use(req, makeRes(), next);

      expect(req.tenant).toBeUndefined();
    });
  });

  describe('the health endpoint', () => {
    it('is let through without resolving, whatever the host', async () => {
      // Health has to keep answering on an unrecognized host -- it is what
      // reports *why* the host is unrecognized.
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/health', 'nope.example.com'), makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('is let through with a trailing slash', async () => {
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/health/'), makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not exempt a path that merely starts with the same characters', async () => {
      // A prefix match here would exempt /api/v1/healthcheck-anything, and
      // "add a route under a prefix" is not a way to opt out of tenant scoping.
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/healthz'), makeRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(404);
    });

    it('is let through with a query string attached', async () => {
      // originalUrl keeps the query string; a raw compare against it would
      // stop exempting health the moment anything appended ?foo.
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/health?verbose=1'), makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not exempt an unrelated route that contains the word health', async () => {
      const middleware = makeMiddleware({ outcome: 'unrecognized' });

      await middleware.use(makeReq('/api/v1/admin/health'), makeRes(), next);

      expect(next).not.toHaveBeenCalled();
    });
  });
});
