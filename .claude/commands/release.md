Cut release $ARGUMENTS.

If $ARGUMENTS is empty, ask Rob what version number to use before doing anything else — never pick or bump a version on your own initiative. This command is the only place version numbers change; nothing else (including the release draft created below) should touch `package.json`.

1. Run `git status`. If there are uncommitted changes unrelated to this release, stop and ask before proceeding — don't bundle unrelated work into the version-bump commit.
2. Draft customer-facing release note copy (title + body) summarizing what changed since the last release. Show it to Rob and get his approval/edits before continuing — don't post it until he's signed off.
3. Once approved, create the release as an **unpublished draft** via the live production API. Never call the publish endpoint from this command — publishing is always a manual step Rob does himself.
   - This is a cookie-authenticated admin-only endpoint. If you don't already have a current `access_token` value in this conversation, ask Rob to paste it (on www.dinnerbears.com: DevTools → Application → Cookies → `access_token`).
   - `curl -s -b "access_token=$TOKEN" -X POST https://www.dinnerbears.com/api/v1/admin/releases -H "Content-Type: application/json" -d '{"version":"<version>","title":"<title>","body":"<body>"}'`
   - A `401` means the token expired — ask Rob for a fresh one and retry once. A `409` means a release row for that version already exists — stop and ask Rob how to proceed rather than creating a duplicate.
   - Confirm the response body includes an `id` before moving on — that's the only proof it was actually created.
4. Update the `"version"` field in `frontend/package.json` and `api/package.json` to $ARGUMENTS.
5. Commit both files: `chore: bump version to $ARGUMENTS`
6. Tag the commit: `git tag -a v$ARGUMENTS -m "Release $ARGUMENTS"`
7. Push: `git push origin main --tags`
8. Build and push the stage image: `bash scripts/publish-stage.sh`
9. Build and push the prod image: `bash scripts/publish-latest.sh`
10. Report back a short summary: draft release created (unpublished) at www.dinnerbears.com, version bumped, commit + tag pushed, both `rtippenhauer/dinnerbears:stage` and `rtippenhauer/dinnerbears:latest` pushed to Docker Hub. Remind Rob the release is sitting as an unpublished draft at `/admin/releases/new` — he reviews and publishes it himself when ready.
