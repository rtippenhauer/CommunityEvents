/**
 * Who actually sent this request, as far as we can honestly tell.
 *
 * **Measured on stage, 2026-10-22.** Thirty-five requests sent from a laptop
 * were all recorded as `104.22.151.132` — a Cloudflare address, not the
 * caller's. The deployment sits behind Cloudflare and then NGINX Proxy
 * Manager, and Express's `req.ip` walks `X-Forwarded-For` only as far as the
 * proxies it has been told to trust, so it stops at the edge. The inbound log
 * then showed "from <a Cloudflare edge node>" for every direct caller, which is
 * exactly the information the field exists to provide and exactly not what it
 * was providing.
 *
 * Same family as the `v2-14` defect where `trust proxy` was unset and every
 * request in the deployment reported `::ffff:127.0.0.1`, turning a per-IP cap
 * into a deployment-wide one. One level better here, and still wrong.
 *
 * ## Why trusting a header is acceptable *here* specifically
 *
 * `CF-Connecting-IP` is set by Cloudflare on every proxied request, and
 * Cloudflare strips any copy the client sent — so behind Cloudflare it is
 * trustworthy, and in front of it, it is whatever the client typed.
 *
 * That would be unacceptable for an access decision and is fine for this,
 * because of what the value is now used for: **a label on a log row, and
 * nothing else.** It was briefly also the key that bounded the log against an
 * anonymous caller, and that is precisely the use this function must not be put
 * to again — a bound an attacker can widen by choosing a header is not a bound.
 * See `FOLDABLE_OUTCOMES` in `inbound-email-log.service.ts`, which now folds on
 * the outcome alone for that reason.
 */
export interface IpBearingRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export function clientIpFrom(req: IpBearingRequest): string | null {
  const header = req.headers?.['cf-connecting-ip'];
  const viaCloudflare = Array.isArray(header) ? header[0] : header;
  if (typeof viaCloudflare === 'string' && viaCloudflare.trim()) {
    return viaCloudflare.trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
