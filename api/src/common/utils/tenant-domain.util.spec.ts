import {
  isOnDeploymentDomain,
  normalizeTenantDomain,
  resolveRootTenantDomain,
} from './tenant-domain.util';

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

describe('isOnDeploymentDomain', () => {
  const DEPLOYMENT = 'communityeventsproject.com';

  it('treats a subdomain of the deployment as on the deployment domain', () => {
    expect(isOnDeploymentDomain('dayton.communityeventsproject.com', DEPLOYMENT)).toBe(true);
    expect(isOnDeploymentDomain('cincinnati.communityeventsproject.com', DEPLOYMENT)).toBe(true);
  });

  it('treats the deployment domain itself as on it — the root tenant IS the deployment', () => {
    expect(isOnDeploymentDomain(DEPLOYMENT, DEPLOYMENT)).toBe(true);
  });

  it('treats a community on its own domain as not on the deployment domain', () => {
    expect(isOnDeploymentDomain('dinnerbears.com', DEPLOYMENT)).toBe(false);
  });

  it('does not match a domain that merely ends with the deployment domain', () => {
    // The whole reason the suffix check carries a dot. Anyone can register
    // these, and matching one would hand a stranger's domain the deployment's
    // Google app and its email credentials.
    expect(isOnDeploymentDomain('notcommunityeventsproject.com', DEPLOYMENT)).toBe(false);
    expect(isOnDeploymentDomain('evil-communityeventsproject.com', DEPLOYMENT)).toBe(false);
  });

  it('matches a deeper subdomain, not just one level', () => {
    expect(isOnDeploymentDomain('a.b.communityeventsproject.com', DEPLOYMENT)).toBe(true);
  });

  it('does not treat the deployment as being on a tenant subdomain (the check has a direction)', () => {
    expect(isOnDeploymentDomain(DEPLOYMENT, 'dayton.communityeventsproject.com')).toBe(false);
  });

  it('normalises both sides, so a Host header and a stored domain agree', () => {
    expect(isOnDeploymentDomain('WWW.Dayton.CommunityEventsProject.com', DEPLOYMENT)).toBe(true);
    expect(isOnDeploymentDomain('dayton.communityeventsproject.com:8081', DEPLOYMENT)).toBe(true);
    expect(
      isOnDeploymentDomain('dayton.communityeventsproject.com', 'https://www.communityeventsproject.com/'),
    ).toBe(true);
  });

  it('is scoped to its own deployment: a stage tenant is not on production', () => {
    // Stage is its own root tenant (REQ-TENANT-01.7), so its communities sit
    // under stage.communityeventsproject.com and are subdomains of stage --
    // but production must not regard them as its own.
    const STAGE = 'stage.communityeventsproject.com';
    expect(isOnDeploymentDomain('dayton.stage.communityeventsproject.com', STAGE)).toBe(true);
    expect(isOnDeploymentDomain('dayton.communityeventsproject.com', STAGE)).toBe(false);
  });

  it('returns false when either side is empty', () => {
    // The no-fallback side deliberately: a deployment that has lost its own
    // domain stops sending mail loudly rather than mailing from an address
    // that describes nobody.
    expect(isOnDeploymentDomain('dayton.communityeventsproject.com', '')).toBe(false);
    expect(isOnDeploymentDomain('', DEPLOYMENT)).toBe(false);
  });
});
