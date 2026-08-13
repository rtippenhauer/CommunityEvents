import { normalizeTenantDomain, resolveRootTenantDomain } from './tenant-domain.util';

/**
 * The whole point of this function is that `www.<domain>` and `<domain>` can
 * never become two tenant rows (REQ-TENANT-01.1). It is used both when the
 * root tenant is written and when a Host header is resolved, so a mismatch
 * between those two paths is a tenant that cannot be reached — or, worse, a
 * second row shadowing the first.
 */
describe('normalizeTenantDomain', () => {
  it('leaves an already-canonical host alone', () => {
    expect(normalizeTenantDomain('communityeventsproject.com')).toBe('communityeventsproject.com');
  });

  it('strips a leading www.', () => {
    expect(normalizeTenantDomain('www.communityeventsproject.com')).toBe(
      'communityeventsproject.com',
    );
  });

  it('maps the www. and bare forms to the same value', () => {
    // This equality is the requirement, stated directly.
    expect(normalizeTenantDomain('www.communityeventsproject.com')).toBe(
      normalizeTenantDomain('communityeventsproject.com'),
    );
  });

  it('keeps a non-www subdomain, which is a different tenant', () => {
    expect(normalizeTenantDomain('demo.communityeventsproject.com')).toBe(
      'demo.communityeventsproject.com',
    );
    expect(normalizeTenantDomain('stage.communityeventsproject.com')).toBe(
      'stage.communityeventsproject.com',
    );
  });

  it('strips only the first www., since www.www. is a genuinely different host', () => {
    expect(normalizeTenantDomain('www.www.example.com')).toBe('www.example.com');
  });

  it('does not strip www from the middle of a label', () => {
    // "wwwx.example.com" and "mywww.example.com" must survive intact — a
    // careless replace(/www\.?/) would mangle both.
    expect(normalizeTenantDomain('wwwx.example.com')).toBe('wwwx.example.com');
    expect(normalizeTenantDomain('mywww.example.com')).toBe('mywww.example.com');
  });

  describe('full URLs, which is how ROOT_TENANT_URL is written', () => {
    it('extracts the host from an https URL', () => {
      expect(normalizeTenantDomain('https://stage.communityeventsproject.com')).toBe(
        'stage.communityeventsproject.com',
      );
    });

    it('extracts the host from an http URL with a trailing slash', () => {
      expect(normalizeTenantDomain('http://example.com/')).toBe('example.com');
    });

    it('drops a path, query and fragment', () => {
      expect(normalizeTenantDomain('https://example.com/some/path?a=1#b')).toBe('example.com');
    });

    it('strips www. from a URL too', () => {
      expect(normalizeTenantDomain('https://www.communityeventsproject.com')).toBe(
        'communityeventsproject.com',
      );
    });
  });

  describe('Host headers, which carry a port when it is non-default', () => {
    it('drops the port', () => {
      expect(normalizeTenantDomain('example.com:8081')).toBe('example.com');
    });

    it('drops the port from a URL', () => {
      expect(normalizeTenantDomain('http://localhost:4300')).toBe('localhost');
    });

    it('keeps an IPv6 literal intact', () => {
      expect(normalizeTenantDomain('[::1]')).toBe('[::1]');
    });
  });

  describe('normalisation of form', () => {
    it('lower-cases, since DNS is case-insensitive but a unique index is not', () => {
      expect(normalizeTenantDomain('WWW.Example.COM')).toBe('example.com');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeTenantDomain('  example.com  ')).toBe('example.com');
    });

    it('drops a fully-qualified trailing dot', () => {
      expect(normalizeTenantDomain('example.com.')).toBe('example.com');
    });

    it('returns empty for empty or whitespace-only input', () => {
      // The caller validates and reports; silently inventing a host would be
      // worse than handing back something obviously unusable.
      expect(normalizeTenantDomain('')).toBe('');
      expect(normalizeTenantDomain('   ')).toBe('');
    });
  });
});

describe('resolveRootTenantDomain', () => {
  it('uses ROOT_TENANT_URL when it is set', () => {
    expect(
      resolveRootTenantDomain({
        ROOT_TENANT_URL: 'https://www.communityeventsproject.com',
        APP_URL: 'https://ignored.example.test',
      }),
    ).toBe('communityeventsproject.com');
  });

  it('falls back to APP_URL, so nothing extra needs setting', () => {
    // The common case: a deployment sets APP_URL and gets a correct root
    // tenant for free.
    expect(resolveRootTenantDomain({ APP_URL: 'https://stage.communityeventsproject.com' })).toBe(
      'stage.communityeventsproject.com',
    );
  });

  it('makes stage and production differ by APP_URL alone', () => {
    const stage = resolveRootTenantDomain({ APP_URL: 'https://stage.communityeventsproject.com' });
    const prod = resolveRootTenantDomain({ APP_URL: 'https://www.communityeventsproject.com' });

    expect(stage).toBe('stage.communityeventsproject.com');
    expect(prod).toBe('communityeventsproject.com');
    expect(stage).not.toBe(prod);
  });

  it('ignores an empty or whitespace-only ROOT_TENANT_URL rather than preferring it', () => {
    // An env var present but blank is the shape a half-filled .env produces;
    // treating it as "set" would resolve to an empty domain.
    expect(
      resolveRootTenantDomain({ ROOT_TENANT_URL: '   ', APP_URL: 'https://example.test' }),
    ).toBe('example.test');
  });

  it('returns empty when neither is set, for the caller to reject', () => {
    expect(resolveRootTenantDomain({})).toBe('');
  });
});
