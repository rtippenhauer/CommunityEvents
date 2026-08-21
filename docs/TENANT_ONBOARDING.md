# Onboarding a community

*The manual, provider-side setup behind a new community: the DNS it needs, the
email account that sends its mail, inbound routing, and Google sign-in. None of
this is automated, and some of it cannot be — verifying a domain means proving
you control it.*

Written against Brevo and Cloudflare because that is what this project uses. If
a community wants a different provider, the shape of the work is the same
(authenticate a sending domain, point inbound mail somewhere, hand the app a
key) and we will deal with the specifics then.

## What a community needs

| | Who does it | When |
| --- | --- | --- |
| A web host (`dayton.example.com`) | Operator | Before creating the tenant |
| A mail domain | Operator or community | Before it sends anything |
| A sending account (Brevo) | Whoever pays for it | Before it sends anything |
| Inbound routing (Cloudflare) | Operator | Before anyone replies to it |
| Google sign-in | Community | Optional — email/password always works |

The web host and the mail domain are **separate settings and usually different
values**. That is deliberate, and it is the single most common thing to get
wrong, so it has its own section below.

---

## 1. The web host

A community is reached at a subdomain of the deployment's domain — say
`dayton.communityeventsproject.com`. Point an A/CNAME record at the same place
the deployment already lives; the app resolves which community a request belongs
to from the `Host` header, so nothing else is needed.

`www.<domain>` and `<domain>` are the same community — the app strips `www.`
before looking a host up, and the database physically refuses to store a domain
carrying that prefix, so the two can never become separate rows.

Unrecognized subdomains return 404. There is no wildcard behaviour to rely on.

## 2. The mail domain — do not reuse the web host

**A community's mail domain is not derived from its web host, and you should not
set it to one.**

The reason is DNS. A tenant subdomain like `dayton.example.com` publishes an A
record so the site resolves. It almost certainly publishes no MX record, no SPF
and no DKIM. Send `hello@dayton.example.com` from it and the mail either fails
SPF at the receiver or bounces silently — and *silently* is the problem, because
the send succeeds as far as the app is concerned.

So pick one of:

- **Share the deployment's mail domain** (`hello@example.com`). Simplest, and
  right when the operator runs the mail for every community. The tenant creation
  dialog prefills this when the new community is a subdomain of the deployment.
- **Give the community its own domain** (`hello@daytondinners.org`). Right when
  the community owns its identity and its own provider account.

Either way it is set explicitly — as `mail_domain` when the community is
created, or later in that community's **Site Settings**. Leaving it blank
inherits the deployment default, which is correct for most communities.

Contact addresses (`hello@`, `calendar@`, `noreply@`) resolve most-specific
first: the community's own address, then a derivation from its mail domain, then
the deployment's env var. Blank means inherit.

## 3. A Brevo account

### One account per deployment, not per community — for now

Today `email_provider_config` is a single global row: one API key and one
sending identity for the whole deployment. Per-community sending is a separate
piece of work, and it is larger than a text field precisely because of the
verification step below.

**Stage and production should not share one Brevo account.** They are separate
deployments with separate databases, and three things in Brevo are account-wide:

1. **The webhook.** One account has one webhook configuration and does not route
   events by sender. Stage's bounces would POST to whichever host is registered
   — so either stage events land in production's database and mark a real
   member's address as bounced, or production's bounces never arrive at all. The
   second is what gets a sending domain blocked.
2. **The daily quota.** Each deployment counts its own sends against its own
   limit, while Brevo enforces one shared limit. Stage testing quietly eats
   production's allowance, and the Resend overflow will not trigger, because
   each deployment's counter looks healthy.
3. **The blocklist.** A stage test that hard-bounces a fake address suppresses
   that address for production too.

Use a second Brevo account for stage, with a different login email.

> **Check this before committing to that split.** Brevo publishes DKIM under a
> fixed selector, so two accounts authenticating the *same* domain may collide
> on the same `_domainkey` record. If they do, give stage its own mail domain
> (`stage.example.com`, or `mail-stage.example.com`) and authenticate that in
> the second account. Confirm in the Brevo console rather than assuming, either
> way.

### Authenticating the sending domain

1. In Brevo: **Senders, Domains & Dedicated IPs → Domains → Add a domain**.
2. Enter the **mail domain** from step 2 — not the web host.
3. Brevo returns DNS records to publish. Typically:
   - a **DKIM** `TXT` record at a `_domainkey` subdomain,
   - a **DMARC** `TXT` record at `_dmarc`,
   - a verification `TXT` record at the domain root.
4. Add them at your DNS provider. In Cloudflare: **DNS → Records → Add record**,
   type `TXT`. **Set these to DNS-only (grey cloud), not proxied** — proxying
   applies to HTTP records, and a proxied record is a common cause of
   "verification never completes".
5. Back in Brevo, click verify. Propagation is usually minutes; give it an hour
   before assuming something is wrong.
6. Add an **SPF** record if the domain has none, or merge Brevo into the
   existing one. A domain may have only **one** SPF record — two is a hard fail,
   not a merge.

Confirm from outside before sending anything real:

```
dig +short TXT <selector>._domainkey.example.com
dig +short TXT _dmarc.example.com
dig +short TXT example.com | grep spf
```

### Giving the app the key

1. In Brevo: **SMTP & API → API Keys → Generate a new API key**.
2. In the app: **Admin → Email → Brevo Credentials**, paste it, save.
3. Set **From Email** and **From Name** on the same screen. The From address
   must be at the domain you just authenticated — a provider rejects a From
   address on a domain it has not verified, which is the whole reason that step
   cannot be skipped.

The key is encrypted before it is stored and is never shown again; the screen
reports only that one is set. To replace it, paste a new one. To remove it, use
**Remove stored key**. See `docs/SECRETS.md`.

### The webhook

1. In Brevo: **Transactional → Settings → Webhooks → Add a new webhook**.
2. URL: `https://<host>/api/v1/email/webhook/brevo?secret=<BREVO_WEBHOOK_SECRET>`
3. Events: at minimum **delivered**, **hard bounce**, **soft bounce**,
   **unsubscribed**, **spam** and **blocked**.

The secret is the `BREVO_WEBHOOK_SECRET` env var. Without a matching one the
endpoint answers 401 and every bounce is silently discarded — which looks like
nothing at all, until the sending reputation drops.

What the webhook does is deliberately **cross-community**: a hard bounce marks
that address bounced everywhere, because a dead address is a property of the
address and not of whichever community happened to mail it. One person can hold
an account in several communities, and continuing to mail a known-dead address
from the others is exactly what gets a domain blocked.

## 4. Inbound mail via Cloudflare

Brevo sends. It does not receive. Replies to `hello@` need somewhere to go or
they bounce — and members do reply.

Cloudflare Email Routing forwards inbound mail to a real mailbox, free:

1. Cloudflare dashboard → the mail domain → **Email → Email Routing**.
2. **Enable Email Routing.** Cloudflare offers to add its MX records
   automatically; accept, unless the domain already receives mail elsewhere — in
   which case stop and work out the interaction first, because MX records are
   not additive in the way people expect.
3. **Destination addresses**: add the real mailbox that should receive replies,
   and click the verification link Cloudflare sends to it.
4. **Custom addresses**: create a route per address the app publishes —
   `hello@`, `calendar@`, `noreply@` — each forwarding to that destination.
5. Optionally add a **catch-all**, so a typo'd address is not simply lost.

Two things worth knowing:

- **Email Routing brings its own SPF requirement.** Cloudflare's MX setup
  includes an SPF entry; make sure it and Brevo's coexist inside the *single*
  permitted SPF record for that domain.
- **`noreply@` should still receive.** Not to be read, but because some
  autoresponders and bounce handlers reply to it, and a hard-bouncing `noreply@`
  damages the domain's reputation like any other address.

Verify by sending mail *to* each published address from an outside account.

## 5. Google sign-in

Optional. A community with no Google credentials offers email/password only, and
there is no platform-wide fallback app — signing a community's members in
through the platform's own OAuth app would make the platform the party those
users granted consent to, which is not what they were asked.

Provider-side setup, which is the same whoever ends up holding the credentials:

1. [Google Cloud Console](https://console.cloud.google.com/) → create or select a
   project.
2. **APIs & Services → OAuth consent screen.** Set the app name, support email
   and authorized domain. External apps serving more than a handful of users
   need verification, which takes time — start it early.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
4. **Authorized redirect URI**: `https://<host>/api/v1/auth/google/callback`.
   This must match exactly — scheme, host, path, no trailing slash. A mismatch
   gives `redirect_uri_mismatch`, which is at least an honest error.
5. Copy the **Client ID** and **Client secret**.

> **Where those values go depends on the release.** Today the deployment uses one
> platform-wide Google app, configured through the `GOOGLE_CLIENT_ID` and
> `GOOGLE_CLIENT_SECRET` environment variables, and OAuth works on the host that
> owns the callback URL. Per-community credentials — a community supplying its
> own pair, with the provider offered only where it has them — are `v2-8`. The
> Google Cloud steps above do not change; only where the app keeps the result.

Facebook follows the same pattern through the Meta app dashboard, and is equally
optional.

## 6. Creating the community

With DNS and mail in place:

1. Sign in to the **root** community as a system admin.
2. **Admin → Communities → New community.**
3. Supply the slug, domain, **mail domain**, and the first admin's name, email
   and password. The first admin is created with the community and is not
   optional: registration needs an invite, invites need an existing member of
   that community, and a community without one is unreachable.
4. Sign in at the new host as that admin, and set branding under **Site
   Settings**.
5. If the community has its own third-party keys (geocoding, Places, Anthropic),
   set them under **Admin → API Keys**. Leaving them unset inherits the
   deployment's, which is usually what you want.

## Checklist

```
[ ] A/CNAME for the web host resolves
[ ] Mail domain decided, and NOT the web host
[ ] Brevo domain authenticated (DKIM + DMARC + SPF all verify from outside)
[ ] Brevo API key set in Admin -> Email; From address on the verified domain
[ ] Brevo webhook registered with the secret, and a test bounce lands
[ ] Cloudflare Email Routing on; every published address forwards, and tested
[ ] Exactly one SPF record on the domain
[ ] Google OAuth client created and redirect URI matched (if wanted)
[ ] Community created with a first admin; sign-in confirmed at its own host
```
