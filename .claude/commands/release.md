Cut release $ARGUMENTS.

If $ARGUMENTS is empty, ask Rob what version number to use before doing anything else — never pick or bump a version on your own initiative. This command is the only place version numbers change; nothing else (including the release draft created below) should touch `package.json`.

1. Run `git status`. If there are uncommitted changes unrelated to this release, stop and ask before proceeding — don't bundle unrelated work into the version-bump commit. Phase branches now merge into `main` as part of `/phase-done`, so you should already be on `main`; if not (e.g. a leftover `bugfix-<slug>` branch with ad hoc work), merge it into `main` first the same way (`git push -u origin <branch>`, `gh pr create`, `gh pr merge --merge --delete-branch`, then `git checkout main && git pull origin main`).
2. Read `docs/NEXT_RELEASE.md` as the starting draft (it accumulates entries from `/phase-done` and ad hoc work between releases). Fold in anything from this session that isn't reflected there yet. Turn it into customer-facing release note copy (title + body). Show it to Rob and get his approval/edits before continuing — don't post it until he's signed off.
3. Once the release notes are approved, create the release as an **unpublished draft** via the live production API. Never call the publish endpoint from this command — publishing is always a manual step Rob does himself.
   - There's a dedicated automation account for exactly this — never ask Rob for his personal `access_token` cookie. Get a token by logging in as automation:
     `curl -s -X POST https://www.dinnerbears.com/api/v1/auth/automation-login -H "Content-Type: application/json" -d '{"secret":"<CLAUDE_AUTOMATION_SECRET prod value>"}'` → returns `{"accessToken": "<jwt>"}`. Use that as `$TOKEN` below. (See memory `reference-automation-secrets` for the actual secret value and `feedback-automation-account-design` for why this exists instead of a personal-cookie or impersonation approach.)
   - `curl -s -b "access_token=$TOKEN" -X POST https://www.dinnerbears.com/api/v1/admin/releases -H "Content-Type: application/json" -d '{"version":"<version>","title":"<title>","body":"<body>"}'`
   - A `401` means either the automation secret is wrong/rotated or the resulting token expired — re-check the memory file for the current secret and retry once; ask Rob only if that doesn't resolve it. A `409` means a release row for that version already exists — stop and ask Rob how to proceed rather than creating a duplicate.
   - Confirm the response body includes an `id` before moving on — that's the only proof it was actually created.
4. On `main`, update the `"version"` field in `frontend/package.json` and `api/package.json` to $ARGUMENTS.
5. Reset `docs/NEXT_RELEASE.md` back to its empty template (see `/phase-done` for the template text) now that its contents have been folded into the created draft.
6. Commit `frontend/package.json`, `api/package.json`, and `docs/NEXT_RELEASE.md` together: `chore: bump version to $ARGUMENTS`
7. Tag the commit: `git tag -a v$ARGUMENTS -m "Release $ARGUMENTS"`
8. Push: `git push origin main` then `git push origin v$ARGUMENTS` — push the
   release tag explicitly rather than `--tags`, so any local-only `phase-*`
   tags from `/phase-done` aren't pushed to GitHub as a side effect.
9. Build and push the stage image: `bash scripts/publish-stage.sh`
10. Build and push the prod image: `bash scripts/publish-latest.sh`
11. Report back a short summary: draft release created (unpublished) at www.dinnerbears.com, version bumped, commit + tag pushed, both `rtippenhauer/dinnerbears:stage` and `rtippenhauer/dinnerbears:latest` pushed to Docker Hub. Remind Rob the release is sitting as an unpublished draft at `/admin/releases/new` — he reviews and publishes it himself when ready.
