Cut release $ARGUMENTS.

If $ARGUMENTS is empty, ask Rob what version number to use before doing anything else — never pick or bump a version on your own initiative. This command is the only place version numbers change; nothing else (including the release draft created below) should touch `package.json`.

1. Run `git status`. If there are uncommitted changes unrelated to this release, stop and ask before proceeding — don't bundle unrelated work into the version-bump commit. Phase branches now merge into `main` as part of `/phase-done`, so you should already be on `main`; if not (e.g. a leftover `bugfix-<slug>` branch with ad hoc work), merge it into `main` first the same way (`git push -u origin <branch>`, `gh pr create`, `gh pr merge --merge --delete-branch`, then `git checkout main && git pull origin main`).
2. Read `docs/NEXT_RELEASE.md` as the starting draft (it accumulates entries from `/phase-done` and ad hoc work between releases). Fold in anything from this session that isn't reflected there yet. Turn it into customer-facing release note copy (title + body), written using the `{{points}}`/`{{locations}}`/`{{events}}` placeholder tokens instead of hardcoded DinnerBears wording (e.g. "the {{points}} leaderboard", not "the Bear Points leaderboard") — the shared note ships to every fork and these get substituted per-instance at render time (see `BrandConfigService`/`updates.component.ts`).
3. Write that copy directly to a new file `api/release-notes/$ARGUMENTS.md`:
   ```
   # <Title>

   <body in markdown>
   ```
   This is a shared, code-level release note (see `docs/RELEASE_NOTE_PIPELINE_SPEC.md`) — it ships inside the Docker image and a boot-time importer (`ReleaseNotesImporterService`) publishes it into every instance's own `releases` table automatically once that instance's container restarts on the new image. Cutting the release **is** the publish approval for this note; there is no separate publish step, and this is a scoped, Rob-approved exception to "Claude never publishes" that applies only to this shared-note path — instance-specific notes (`/admin/releases/new`) are completely unaffected and still require a manual publish click.
   Then **stop and hand off to Rob**: tell him the file is written and where, and that he should open it, edit the copy directly in his own editor, save it, and tell you when he's done. Don't proceed to step 4 until he confirms — re-read the file at that point rather than assuming your originally-written copy is still what's on disk, since he may have rewritten it.
4. On `main`, update the `"version"` field in `frontend/package.json` and `api/package.json` to $ARGUMENTS.
5. Reset `docs/NEXT_RELEASE.md` back to its empty template (see `/phase-done` for the template text) now that its contents have been folded into `api/release-notes/$ARGUMENTS.md`.
6. Commit `frontend/package.json`, `api/package.json`, `docs/NEXT_RELEASE.md`, and `api/release-notes/$ARGUMENTS.md` together: `chore: bump version to $ARGUMENTS`
7. Tag the commit: `git tag -a v$ARGUMENTS -m "Release $ARGUMENTS"`
8. Push: `git push origin main` then `git push origin v$ARGUMENTS` — push the
   release tag explicitly rather than `--tags`, so any local-only `phase-*`
   tags from `/phase-done` aren't pushed to GitHub as a side effect.
9. Build and push the stage image: `bash scripts/publish-stage.sh`
10. Build and push the prod image: `bash scripts/publish-latest.sh`
11. Report back a short summary: version bumped, commit + tag pushed, both `rtippenhauer/community-events:stage` and `rtippenhauer/community-events:latest` pushed to Docker Hub. Note that the release note now ships inside both images and will auto-publish on stage and prod as each container restarts on the new image — no manual publish step for Rob on this one.
