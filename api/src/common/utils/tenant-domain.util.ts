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
