# Release-Note Pipeline — Scoped Spec

_Status: **built**, on the `phase-33-white-label-finishing-touches` branch (2026-07-27)._

## Problem

Since Phase 31, every instance (DinnerBears, Sons, …) runs the **same image**. Release
notes that describe a code change are therefore genuinely shared content. But two
properties are **not** shared and break any naive sharing:

1. **Version skew.** Instances update their containers on their own schedules. A note
   must only appear on an instance once that instance actually runs the version the
   note describes — otherwise Sons on v1.4 advertises v1.5 features it doesn't have.
2. **Terminology.** A shared note that says "Bear Points Leaderboard" is wrong on Sons
   ("Points Leaderboard"). Shared text must be term-neutral or run through the same
   `BrandConfigService` substitution the UI uses.

**Rejected alternatives** (both re-introduce the cross-instance coupling Phase 31 removed):

- **Shared DB** — every instance would need a network path to one DB; new failure mode
  and security surface on the one thing currently isolated. Doesn't solve version skew.
- **DinnerBears-as-source** — makes DinnerBears a privileged origin the other forks
  depend on being online; bakes in an assumption that one operator runs every fork.

## Model: repo is the single source of truth, shipped in the image, imported at boot

Release notes for shared code changes are a property of the **version**, so they live
with the code — a small extension of the existing repo-based `docs/NEXT_RELEASE.md` flow.
Two tiers:

| Tier | Lives in | Delivered by | Published where |
|------|----------|--------------|-----------------|
| **Shared release note** (describes the code) | repo, shipped in image | boot-time importer | every instance, auto |
| **Instance-specific note** | that instance's DB | `/admin/releases/new` (by hand) | that instance, manual publish |

Nothing new is networked or secured; each instance still writes only to its own DB.

## Delivery mechanism: a boot-time importer (not a one-time migration)

A one-time seed migration is wrong here because the **stage draft changes every
`/phase-done`** and must re-import. Instead, a small **boot-time importer** runs in the
app bootstrap (alongside the existing `typeorm migration:run` in `docker/entrypoint.sh`),
reads the notes shipped in the image, and **upserts** them into the local `releases`
table, idempotent and keyed by version:

- **Finalized released entries** (cut by `/release`) → seeded **published** on **every**
  instance (stage + prod).
- **The in-progress `docs/NEXT_RELEASE.md` draft** → seeded published **only when
  `IS_STAGE=true`**, **skipped on prod**.

That `IS_STAGE` gate is the core guarantee: the 3–4 mid-cycle stage pushes during a cycle
**can never surface on prod**. Prod only ever imports what `/release` has finalized.

## Command flow

Reuses the two commands already run — no new commands.

### `/phase-done` → stage
- Already appends the phase's summary to `docs/NEXT_RELEASE.md` and pushes a stage image.
- **New:** the shipped draft is published by the importer **on stage only**, so stage
  shows the accumulating note grow phase by phase. The same draft is edited in place
  across the whole cycle — this is where Rob reviews and changes the verbiage.

### `/release <final-version>` → prod
- **Changed:** instead of `POST`-ing a draft into prod's `releases` API, it **promotes**
  `docs/NEXT_RELEASE.md` into a finalized, versioned changelog entry in the repo, stamps
  the final landed version, clears `NEXT_RELEASE.md`, bumps `package.json`, commits, tags,
  and builds/pushes both images.
- On update, prod's importer publishes the finalized note; stage's draft entry collapses
  into that same released note.
- The **manual publish click goes away for shared notes** (the release cut is the
  approval). Manual publish stays only for instance-specific notes.

## Content format

- **Markdown** in `NEXT_RELEASE.md` using Rob's terminal style — bold headings and
  horizontal rules — converted **markdown → HTML** at import time into `releases.body`.
  `body` is already rich HTML (same ngx-quill editor as legal copy; the updates page
  already renders it), so this is a conversion step, not new rendering.
- **Terminology** via placeholder tokens (`{{points}}`, `{{locations}}`, `{{events}}`)
  substituted at render through `BrandConfigService`, or kept generic. _Either is
  acceptable; placeholders recommended._

## Open items to pin before building

1. **Draft version label.** `releases.version` is `NOT NULL`, but the stage draft has no
   final version yet — use a placeholder label (e.g. `Upcoming`) reconciled/superseded
   when `/release` stamps the real version. The importer must supersede the placeholder
   cleanly, not leave a duplicate.
2. **Terminology:** placeholder tokens vs. generic wording (recommend tokens).
3. **Phase placement:** fold into Phase 33 or spin as its own small phase.
4. **Optional:** an "Upcoming release" preview panel on stage rendering `NEXT_RELEASE.md`
   directly — largely redundant once the importer publishes the draft into stage's normal
   updates UI.

## Build checklist

- [x] Repo changelog format: `docs/NEXT_RELEASE.md` stays the single evolving draft;
      finalized entries live in `api/release-notes/<version>.md` (one file per release,
      `# Title` + markdown body), committed by `/release`.
- [x] Boot-time importer service (`ReleaseNotesImporterService`, `OnApplicationBootstrap`
      in `api/src/modules/releases/`): reads shipped notes, markdown→HTML via `marked`
      (sanitized with the same `ALLOWED_HTML` policy the admin editor uses), upserts into
      `releases` keyed by version; finalized entries publish on every instance, the draft
      (`_draft.md`, `docs/NEXT_RELEASE.md` copied in at Docker build time) publishes only
      when `IS_STAGE=true` under the placeholder version `'Upcoming'`, and is deleted
      again once `IS_STAGE=false` or the draft has no real content past the reset
      template.
- [x] Render-time token substitution via `BrandConfigService` (frontend) for
      `{{points}}`/`{{locations}}`/`{{events}}` — done in `updates.component.ts`'s
      `safeHtml()`.
- [x] Rewrote `/release`: writes the approved note to `api/release-notes/<version>.md`
      instead of POSTing an unpublished draft to the live prod API; no separate
      publish step for shared notes — cutting the release is the approval.
- [x] `/phase-done`: no behavioral change to what Rob does; documented that the draft
      now surfaces automatically on stage once the stage image restarts.
- [x] Docker: `.dockerignore` exceptions for `api/release-notes/` and
      `docs/NEXT_RELEASE.md`; `Dockerfile` copies `docs/NEXT_RELEASE.md` to
      `release-notes/_draft.md` in the api-build stage and copies the whole
      `release-notes/` directory into the production image.
- [x] e2e coverage: `api/test/release-notes-import.e2e-spec.ts` (finalized-note import,
      idempotent re-import, the `IS_STAGE` gate on the draft, empty/missing-dir cases).
