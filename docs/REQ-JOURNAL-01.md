# REQ-JOURNAL-01 — Personal journal, journal apps and reference library

**Project:** Community Events
**Area:** New feature track (post-cutover)
**Status:** Draft (2026-10-18)
**Depends on:** REQ-TENANT-01 (tenant scoping, per-tenant OAuth, custom domains).
Independent of REQ-CMS-01, but designed so its page templates can become CMS
blocks later (see 01.2).

## Summary

A community can be a small private group — the first is a coven — whose
members each keep a **private journal**, share a **reference library**, and
meet through ordinary **events**. This began as a standalone app
(`rtippenhauer/BookOfShadows`, private) and was folded in here on 2026-10-18
because nearly everything it needed already exists: tenants, invites, Google
login with the tenant's own OAuth app (`v2-8`), the callback on the
community's own host (`v2-12`), `feature_*` toggles, and the AI enrichment
pattern in `locations/enrichment.service.ts`.

The first coven tenant will be served on its own custom domain. Its private
content (dedication, original book text, illustrations) lives in the private
BookOfShadows repository and **never** enters this public repository or any
image built from it. It is loaded at runtime as tenant data.

Each feature sits behind its own toggle: `feature_journal`,
`feature_library`. A community with neither switched on sees no change.

## 01.1 Private journal pages (`v2-36`)

- `journal_pages`: `tenant_id`, `owner_user_id`, `template_key`, `title`,
  `settings` (JSON), `content` (JSON), `revision` (int), timestamps, soft
  delete. Index `(tenant_id, owner_user_id, updated_at)`.
- `journal_page_revisions`: an append-only history of `content` per save.
- **Owner-only, including against admins.** This is the one new rule in this
  track. Elsewhere a tenant admin can read everything in the tenant and a
  system admin can act on any tenant. Here nobody but the owner can read a
  journal page through the app — not the tenant admin, not the system admin,
  not with `runUnscoped`. The owner always comes from the session and is never
  taken from a request parameter. Every read, write, export and revision path
  filters on both `tenant_id` (the tenant extension) and `owner_user_id`
  (explicitly in the service).
- **Honest wording:** whoever operates the host can still read the database.
  The UI says "private to you in this app" and never "encrypted" or "no one
  can see this".
- **Autosave with conflict detection.** A save sends the `revision` it was
  based on. If that is stale (the page was edited on another device), the
  server returns 409 with the current version and the client offers "keep
  mine / take theirs / view both". Nothing is silently overwritten. The UI
  shows saving / saved / failed-retrying states.
- Only the `freeform` template ships in this item.

**Definition of done:** a member can create, edit and delete their own pages
on phone and desktop. E2e tests run two members of one tenant plus a member of
a second tenant and prove that **each** journal route — list, get, update,
delete, revisions — returns 404 for a page the caller doesn't own, including
when the caller is that tenant's admin or a system admin. A stale-revision save
returns 409 and leaves the stored content unchanged.

## 01.2 Journal apps — page templates (`v2-37`)

A page's `template_key` selects a small registry entry: a backend settings
schema (validated on save) plus a frontend component. This is deliberately the
same shape as REQ-CMS-01.2's block registry, so v2-19 can adopt the templates
as blocks instead of re-implementing them.

Initial templates: `gratitude-prayer` (dated entries), `monthly-intentions`
(set at the start of the month, reflected on at the end), and guided-prompt
pages (prompt list in `settings`, one labelled text area per prompt). A
community can seed **starter pages** that are copied into a member's journal
when they join. The copy belongs to the member; a later change to the starter
never rewrites it.

**Definition of done:** each template can be added as a page, its settings are
validated server-side, and editing a starter template leaves existing members'
copies untouched (tested).

## 01.3 Reference library (`v2-38`)

A shared wiki for each tenant: `library_pages` (`tenant_id`, `slug`, `title`,
`topic`, `body` as markdown, `status` draft/published, `sources` JSON,
`created_by`, `revision`) plus `library_page_revisions`. Every member can read
it. Full-text search over title and body.

**Enrich, then review.** A member creates a page with a title and a topic and
presses Enrich. The API asks Claude for a draft. The draft is saved with
`status = draft` and is visible only to its creator until they edit and
publish it — an AI page never appears in the shared library unreviewed.

- Model: `claude-opus-5-5` by default (configurable). Web search
  (`web_search_20260209`, with a small `max_uses`) so drafts cite real sources;
  `sources` stores each source's URL and title.
- Credentials: the tenant's `anthropic_api_key` from `tenant_secrets`, the same
  way enrichment resolves it today. With no key set, the Enrich button is
  hidden.
- **Editorial rules sent to the model on every request:** keep observable
  fact, traditional association (with a source) and personal meaning
  separate; make no medical or healing claims; never present one culture's
  practice as universal, or claim authority for Indigenous or closed
  traditions; mark anything that is uncertain as uncertain.
- **Members' notes on a library page** are journal content: a member's
  annotation is a `journal_pages` row (`template_key = library-note`, with the
  `library_page_id` in `settings`), so it is owner-private under 01.1 and is
  never touched when the library page is edited or re-enriched.
- Any member can enrich. **Per-member daily limits are deferred.** The intended
  rule is a per-tenant daily budget, with each member capped at about 5% of
  it. The `enrichment_requests` log row (tenant, user, timestamp, tokens)
  ships in this item so the limit can be added later without a migration.

**Definition of done:** create → enrich → edit → publish works end to end; a
draft is invisible to other members (tested); a re-enrich or edit leaves
members' notes untouched (tested); missing key → no Enrich button, and the
manual page still works.

## 01.4 Library illustrations (`v2-39`)

Generated illustrations for library pages, in the tenant's chosen style (for
the first coven: graphite pencil on white). Claude does not generate images,
so this needs an image-generation provider and its key in `tenant_secrets` —
**the provider is chosen when this item starts**. Images go into the shared
media pipeline (`v2-18`) if it exists by then, otherwise into private tenant
storage. The same draft → review rule applies to illustrations.

## 01.5 Calendar app and repeating events (`v2-40`)

- A `calendar` journal template whose settings choose what it overlays: the
  Wheel of the Year (eight sabbats), primary moon phases, and the member's own
  dated entries. Astronomical data comes from published tables (USNO) for
  given years, stored as reference data, not computed by an AI.
- **Repeating events** (weekly / monthly) for group meetings. Events have no
  repeat rule today. This is the one piece of the track that touches existing
  event code, which is why it comes last.

## Out of scope for now

Sharing journal pages between members, end-to-end encryption, astrology
content, photo attachments on journal pages, and print/PDF export. Print
export is wanted later. It renders saved text only, never a draft.
