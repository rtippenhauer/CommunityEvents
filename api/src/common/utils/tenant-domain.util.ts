/**
 * Canonical form for a tenant's `domain` column, and for anything compared
 * against it.
 *
 * REQ-TENANT-01.1 requires that `www.<domain>` and `<domain>` resolve to the
 * same tenant row and never become two rows. Rather than storing both forms
 * and hoping every lookup checks both, the `www.` prefix is stripped on the
 * way in — the column physically cannot hold it — and every lookup normalises
 * its input the same way. One function, used by the tenant seed in bootstrap
 * and by the Host-header middleware (REQ-TENANT-01.2), so the two cannot drift.
 *
 * Accepts either a full URL (ROOT_TENANT_URL is written as one) or a bare
 * host (a Host header is not). A Host header also carries the port when it is
 * non-default, which is why the port is dropped rather than trusted.
 */
export function normalizeTenantDomain(input: string): string {
  let host = input.trim().toLowerCase();
  if (!host) return '';

  // Full URL -> host. Anything without a scheme is treated as a bare host,
  // since `new URL('example.com')` throws rather than doing the obvious thing.
  if (host.includes('://')) {
    try {
      host = new URL(host).host;
    } catch {
      // Malformed URL: fall through and treat what is left as a host. The
      // caller validates; returning '' here would hide the bad value.
      host = host.slice(host.indexOf('://') + 3);
    }
  }

  // Strip any path, query or fragment left over from a bare host that still
  // carried one (e.g. "example.com/foo").
  host = host.split('/')[0].split('?')[0].split('#')[0];

  // Drop the port. IPv6 literals are bracketed, so only split on the last
  // colon when the host is not bracketed.
  if (!host.startsWith('[')) {
    const colon = host.lastIndexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }

  // Trailing dot is legal in DNS (a fully-qualified name) and would otherwise
  // make "example.com." a different tenant from "example.com".
  host = host.replace(/\.$/, '');

  // Only one leading "www." is meaningful; "www.www.example.com" is a genuinely
  // different host and is left alone.
  if (host.startsWith('www.')) host = host.slice(4);

  return host;
}

/**
 * Where the root tenant's domain comes from at bootstrap.
 *
 * REQ-TENANT-01.4 names ROOT_TENANT_URL as bootstrap config, so it stays
 * settable — but it is redundant with APP_URL on every deployment where they
 * agree, which is all of them so far. Defaulting to APP_URL means a stage and a
 * production instance differ by APP_URL alone, which they already had to, and
 * nobody has to remember a second hostname setting that silently points the
 * root tenant at the wrong host if it is left at a copied default.
 *
 * BASE_DOMAIN is deliberately NOT in this chain despite looking similar. It is
 * the *mail* domain — instance-contact.ts derives calendar@, hello@ and
 * noreply@ from it, and v1 sets it to the apex precisely because `www.` has no
 * MX record. A tenant's domain is a web host, and REQ-TENANT-01.7 requires auth
 * cookies be scoped to the exact tenant host rather than a shared parent, so
 * conflating the two is the kind of thing that ends in one tenant's session
 * working on another's domain.
 */
export function resolveRootTenantDomain(env: {
  ROOT_TENANT_URL?: string;
  APP_URL?: string;
}): string {
  const source = env.ROOT_TENANT_URL?.trim() || env.APP_URL?.trim() || '';
  return normalizeTenantDomain(source);
}

/**
 * Whether a community lives on this deployment's own domain, rather than on a
 * domain it brought itself.
 *
 * This one predicate decides three separate things (v2-12), which is the reason
 * it is derived from the domain rather than stored as a flag on `tenants`:
 *
 *  - **which Google redirect URI applies** -- the deployment's single
 *    registered one, or the community's own host;
 *  - **whether the OAuth callback needs the `oauth_handoffs` hop** -- it does
 *    only when the callback lands somewhere other than the community's host;
 *  - **whether the deployment's email credentials may be fallen back on.**
 *
 * All three answer the same underlying question -- *whose* domain is this? --
 * and a stored boolean would be a fourth answer that could disagree with the
 * other three. Deriving it means a community's domain is the only thing that
 * has to be right.
 *
 * The rule (decided with Rob 2026-09-08) is that a community on a subdomain of
 * this deployment visibly *is* the platform: a Google consent screen naming the
 * platform is accurate there, and so is a From address on the deployment's mail
 * domain. A community on its own domain presents as its own entity, where
 * neither is -- which is what REQ-TENANT-01.9's "no platform-wide fallback app"
 * was really reaching for. It also matches what is physically possible: adding
 * an authorised redirect URI needs Search Console ownership of the domain, so
 * a community on its own domain could not use this deployment's Google project
 * even if policy allowed it (v2-8's four-case table, row 4).
 *
 * The root tenant itself counts as on the deployment domain -- it *is* the
 * deployment domain.
 *
 * Both arguments are normalised here rather than at the call sites, so a caller
 * that passes a raw Host header or a full URL gets the same answer as one that
 * passes a stored `domain` column.
 *
 * An empty deployment domain returns false -- "own domain", the no-fallback
 * side. It is unreachable in practice (APP_URL is read with `getOrThrow`), and
 * it is the deliberate direction: a deployment that has lost its own domain
 * stops sending mail loudly, rather than quietly mailing every community from
 * an address that no longer describes anyone.
 */
export function isOnDeploymentDomain(tenantDomain: string, deploymentDomain: string): boolean {
  const tenant = normalizeTenantDomain(tenantDomain);
  const deployment = normalizeTenantDomain(deploymentDomain);
  if (!tenant || !deployment) return false;

  // The suffix match carries the dot deliberately. Comparing with `endsWith`
  // on the bare domain would make `notcommunityeventsproject.com` a subdomain
  // of `communityeventsproject.com`, which is a domain somebody else can
  // register.
  return tenant === deployment || tenant.endsWith(`.${deployment}`);
}
