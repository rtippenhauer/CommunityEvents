Cut release $ARGUMENTS.

If $ARGUMENTS is empty, ask Rob what version number to use before doing anything else — never pick or bump a version on your own initiative. This command is the only place version numbers change; nothing else (including publishing release notes in the admin UI) should touch `package.json`.

1. Run `git status`. If there are uncommitted changes unrelated to this release, stop and ask before proceeding — don't bundle unrelated work into the version-bump commit.
2. Update the `"version"` field in `frontend/package.json` and `api/package.json` to $ARGUMENTS.
3. Commit both files: `chore: bump version to $ARGUMENTS`
4. Tag the commit: `git tag -a v$ARGUMENTS -m "Release $ARGUMENTS"`
5. Push: `git push origin main --tags`
6. Build and push the stage image: `bash scripts/publish-stage.sh`
7. Build and push the prod image: `bash scripts/publish-latest.sh`
8. Report back a short summary: version bumped, commit + tag pushed, both `rtippenhauer/dinnerbears:stage` and `rtippenhauer/dinnerbears:latest` pushed to Docker Hub. Remind Rob that the customer-facing changelog entry is still created separately via `/admin/releases/new` — this command only handles the version bump and image publish, not the release notes.
