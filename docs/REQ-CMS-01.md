# REQ-CMS-01 — Page CMS, Shared Media, Discussion & Galleries

**Project:** Community Events
**Area:** Content management / community features
**Status:** Draft
**Depends on:** REQ-TENANT-01 (tenant foundation — complete as of v2-8;
REQ-TENANT-01.8/.9 are what v2-8 built). Sequenced after v2-17
(REQ-VALIDATE-01) and the rest of the current `V2_PHASES.md` backlog
(v2-13 through v2-16),
run sequentially rather than in parallel with it.

## Summary

Adds the tenant-editable content layer on top of the tenant foundation:
a block-based page builder, a shared media/upload pipeline used by every
rich-text surface, a DB-driven menu system, a threaded discussion board,
and event photo galleries. This was scoped conversationally across several
planning sessions but never formalized into a requirements doc or added to
`V2_PHASES.md` — this doc closes that gap.

## Background

Tenant admins need to build and edit pages (hero pages, landing pages,
custom pages) without a code change per page, using a fixed library of
configurable blocks rather than freeform HTML. Several features that
depend on file uploads — discussion posts, event photos, feedback
attachments — should share one upload pipeline rather than each inventing
its own. Menus need to be DB-driven and tenant-editable, with admin/profile
menus staying structurally fixed but feature-flag gated per item.

## Implementation order

Build in this sequence — each layer is a real dependency of the one after it:

1. **REQ-CMS-01.1 (shared media pipeline)** — first, since discussion posts,
   event photos, and feedback attachments all depend on it. Building it once
   here avoids three separate upload implementations converging awkwardly
   later.
2. **REQ-CMS-01.2 (page/block CMS foundation)** — block registry, page
   model, sanitized HTML-subset block. Built before the block *library*
   (step 3) so the library is just "register a new block type," not a
   parallel system.
3. **REQ-CMS-01.3 (block library)** — the actual set of blocks (events,
   locations, leaderboard, etc.), each wired to existing modules' APIs.
4. **REQ-CMS-01.4 (menu system)** — DB-driven nav, feature-flag gating.
   Built after pages exist, since menu items point at pages by slug.
5. **REQ-CMS-01.5 (discussion board)** — depends on media pipeline (step 1)
   for photo attachments and threaded replies.
6. **REQ-CMS-01.6 (event photo galleries)** — depends on media pipeline
   (step 1); can be built in parallel with the discussion board (step 5)
   if parallel work is ever adopted, but is sequenced after it here.

## Non-validated member restrictions (cross-cutting)

Non-validated members are treated as guests, not partially-trusted
members — this is a platform-wide boundary, not a per-feature decision,
and applies to every requirement below:

- **No uploads of any kind** — no discussion post photos, no event
  photos, no profile photo. Enforced at the shared media pipeline
  (REQ-CMS-01.1) so it's one check, not one per feature that happens to
  call it.
- **No posting/commenting** — no discussion posts/replies, consistent
  with their existing event-comment restriction.
- **No visibility into other members' person-level info** — leaderboard,
  member directory, and any block surfacing member identity/points/rank
  are hidden from non-validated members, not merely read-only. This
  applies to the Leaderboard Snippet, Full Leaderboard, and Member
  Directory blocks (REQ-CMS-01.3) and their existing non-block
  equivalents.
- All of the above enforced server-side (API guard, not just UI hiding),
  matching the project's existing rule that role-gated data is omitted
  server-side rather than hidden client-side.

## Requirements

### REQ-CMS-01.1 — Shared media pipeline

- Single `media` table: `id`, `tenant_id`, `attached_to_type` (enum:
  `discussion_post`, `event_photo`, `feedback`, reserved values for future
  contexts), `attached_to_id`, `uploaded_by`, `file_path`, `caption`
  (nullable), `created_at`, `deleted_at` (soft delete).
- One upload endpoint, tagged by context at call time — not a separate
  endpoint per feature.
- Reuses the existing upload/static-asset serving pattern already in
  `main.ts` (`useStaticAssets` per category) rather than inventing new
  storage handling.
- **Auth-gating on uploaded files is closed here.** This was flagged as an
  open gap in the original DinnerBears backlog and would otherwise be
  reintroduced in three places (discussion, events, feedback) instead of
  fixed once.
- **Non-validated members are blocked from the upload endpoint itself**
  (see "Non-validated member restrictions" above) — this is the one place
  to enforce it so discussion, event photos, and feedback attachments
  can't each need their own check.
- **Paste-to-upload directive** (`appPasteImage` or similar), wired to
  every rich-text surface platform-wide: discussion posts/replies, feedback
  tickets/notes, event comments, announcements. Listens for clipboard image
  data on `paste`, converts to a `File`/`Blob`, hands it to the same upload
  service as the file-picker/drag-and-drop path.

### REQ-CMS-01.2 — Page/block CMS foundation

- `pages` table (tenant-scoped): `id`, `tenant_id`, `slug`, `title`,
  `template` (nullable — a starting-point seed, not a permanent rendering
  path), `created_at`, `updated_at`.
- `page_blocks` table: `id`, `page_id`, `block_type`, `config` (JSON),
  `order`.
- Block type registry (backend: config schema validation per type;
  frontend: Angular component registry, dynamic component loading keyed by
  `block_type`).
- **Custom HTML block** — sanitized subset, not raw HTML. Allowlisted tags
  (div, span, headings, p, a, img, ul/ol/li, table, blockquote), allowlisted
  attributes (class, restricted `style` properties, `href`/`src` limited to
  allowlisted embed domains). `<script>`, inline event handlers,
  `javascript:` URLs, and non-allowlisted `<iframe>` sources are stripped
  unconditionally server-side (e.g. via `sanitize-html` with an explicit
  config, not custom parsing).
- **Rich Text block** — sanitized WYSIWYG, the safe default for prose;
  reuses the paste-to-upload directive from REQ-CMS-01.1.
- Page builder admin UI: add/reorder/remove blocks, per-block config form
  generated from each block type's schema.
- Permission model: tenant admins manage pages for their own tenant;
  system admin can manage any tenant's pages (per the system-admin/
  tenant-admin split established in REQ-TENANT-01).

### REQ-CMS-01.3 — Block library

Each block below is a config + a component that calls existing module
APIs — no new backend logic beyond what the block's config needs (mostly
filter/count parameters):

**Content**
- Hero (headline/subhead/image/CTA button)
- Rich Text (from REQ-CMS-01.2)
- Custom HTML (from REQ-CMS-01.2)
- Image / Gallery
- Signup Form

**Events**
- Upcoming Events List (config: count, date range)
- Full Event Calendar (month/list view)
- Event Detail (single event — singular per page)
- Event Register/RSVP (standalone, embeddable outside event detail)

**Community**
- Leaderboard Snippet (config: count) — hidden from non-validated members
- Full Leaderboard — hidden from non-validated members
- Member Directory — hidden from non-validated members
- Announcements Feed
- Discussion Thread (page-level, not just event-level — depends on
  REQ-CMS-01.5)

**Locations**
- Location Spotlight (single, editorial pick)
- Location Directory (full searchable list)
- Location Ratings Summary

**Feedback**
- Feedback Board Embed
- Public Changelog Embed

Each "list" block shares a common config shape (count/limit, sort/filter)
rather than one-off per block. Singular-per-page blocks (Event Detail,
Signup Form) are flagged in the registry so the page builder can warn on
duplicate placement.

**Open question carried from planning, not yet decided:** conditional
block visibility (e.g. hide Signup Form for already-logged-in members) —
out of scope for this doc unless decided before implementation starts.
Default: out of scope for v1; admins build separate logged-in/logged-out
pages if needed.

### REQ-CMS-01.4 — Menu system

- `menu_items` table (tenant-scoped): `id`, `tenant_id`, `label`,
  `target_type` (`page` | `external_link`), `target_id` or `url`, `order`,
  `feature_flag` (nullable), `menu_context` (enum: `main`, `admin`,
  `profile`).
- Menu item pointing at `target_type: 'page'` covers both custom and
  "system" pages — same object, no special-casing.
- Admin and Profile menus stay structurally fixed (same nav shell/route
  tree) but each entry's visibility is gated by `feature_flag`, enforced
  server-side (route guard/API guard), not just hidden client-side — same
  pattern already established for `BrandConfigService`'s `features` signals
  and the `@RequireFeature` guard.
- New tenants get their standard nav (Events, Leaderboard, Locations, etc.)
  auto-seeded as real pages built from templates on tenant creation, so a
  new tenant looks complete on day one without hand-building every page.

### REQ-CMS-01.5 — Discussion board

- `discussion_categories` (tenant-scoped): admin-managed, ordered.
- `discussion_topics`: title, category_id, author, created_at,
  pinned/locked flags.
- `discussion_posts`: topic_id, author, body, `parent_post_id`
  (self-reference, nullable — enables real threading, not the one-level
  cap used by event comments), created_at, deleted_at (soft delete).
- Depth cap for rendering sanity (e.g. flatten past 3–4 levels with a
  "continue thread" pattern) — not infinite recursion in the template.
- Photos via the shared `media` table (REQ-CMS-01.1),
  `attached_to_type: 'discussion_post'`.
- Plugs into the existing `content_reports` system: add `discussion_topic`
  and `discussion_post` to the `content_type` enum, reuse the existing
  report button component and mod queue.
- **Non-validated members cannot post, reply, or upload photos** —
  read-only, same principle as their existing restriction on event
  comments. Enforced server-side on the post/reply/upload endpoints, not
  just hidden in the UI.

### REQ-CMS-01.6 — Event photo galleries

- `event_photos`-equivalent via the shared `media` table,
  `attached_to_type: 'event_photo'`, `attached_to_id`: event id.
- Upload gated to members with `attended = true` for that event — reuses
  the existing attendance-verification check already built for ratings
  eligibility, not a new eligibility system. Non-validated members are
  excluded outright regardless of attendance (see cross-cutting
  restrictions above) — attendance alone isn't sufficient.
- Grid/lightbox display on the event detail page.
- Doubles as a "Photo Gallery" block (REQ-CMS-01.3) for pulling recent
  event photos onto any page.
- Same `content_reports` hook for inappropriate photos.

## Testing requirements

Per project convention (Vitest + Supertest + Playwright):

- **Unit (Vitest):** block config schema validation, HTML sanitizer
  allowlist behavior (explicit tests for stripped `<script>`/event
  handlers/`javascript:` URLs), paste-to-upload directive's clipboard
  handling, discussion thread depth-cap rendering logic.
- **Integration (Supertest):** media upload endpoint tagged correctly per
  context and tenant-scoped; sanitizer strips dangerous input end-to-end
  through the actual page save path (not just the unit-level function);
  event photo upload rejected for a member with `attended = false`;
  discussion post/topic CRUD respects tenant scoping and soft delete;
  content-report hook fires correctly for the two new content types.
- **E2E (Playwright):** build a page with several block types in the admin
  UI and confirm it renders correctly on the public side; post a threaded
  discussion reply with a pasted screenshot; upload an event photo as an
  attendee and confirm a non-attendee cannot.

## Out of scope (deferred)

- Conditional block visibility (logged-in/logged-out variants of a block)
- Sub-community-scoped pages/menus (depends on the sub-community feature,
  itself deferred per REQ-TENANT-01)
- Per-tenant custom CSS beyond the existing brand color/logo system
- Page versioning/drafts (pages publish immediately on save for v1)

## Definition of done

- A tenant admin can create a page, add/reorder/remove blocks from the
  full library, and the page renders correctly on the public site
- Custom HTML block cannot execute injected scripts or event handlers —
  verified by a failing-if-unfixed integration test
- Discussion board supports real threaded replies with photo attachments,
  moderation via the existing report/mod-queue system
- Event photo galleries are attendance-gated and display correctly on the
  event detail page and as a reusable block
- Menu items (main, admin, profile) are DB-driven and feature-flag gated
  server-side, not just hidden in the UI
- All new code covered by unit, integration, and the listed E2E flows
