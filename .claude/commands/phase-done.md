Phase $ARGUMENTS is complete. 

0. Confirm the current branch is this phase's branch (`phase-$ARGUMENTS-*`), not `main`. If somehow on `main`, stop and ask Rob before committing anything — all phase work and its doc updates belong on the phase branch; `main` only changes at `/release` time.

1. Provide a customer-friendly release note summary of everything completed.
   Append it to `docs/NEXT_RELEASE.md` under a heading for this phase's area
   (create the file from the template below if it doesn't exist yet). Don't
   remove or rewrite existing entries already in the file — only add to it.
   This is a draft accumulator, not a publish action — it does not touch the
   `releases` table or the production API.

   ```
   # Next Release — Draft Notes

   Running draft of unreleased, customer-facing changes. Appended to automatically
   by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
   `/release` uses this file as the starting draft and clears it back to empty
   once that release's draft has been created.
   ```

2. Update CLAUDE.md:
   - Move the current phase to the completed list (collapsed to a single line)
   - Update "Current Development Phase" to the next phase with a one-sentence summary
   - Remove any context specific to the finished phase that won't carry forward
   - Do not touch conventions, stack info, or DB rules

3. Update PHASES.md:
   - Add ✅ Complete to the finished phase header
   - Add ✅ In Progress to the next phase header

4. Update docs/DATABASE_SCHEMA.md:
   - Add any new tables introduced in this phase
   - Update any modified tables (new columns, indexes, enum values)
   - Update the _Last updated_ date at the top
   - Update the Table Index to include new tables

5. Commit all four files (CLAUDE.md, PHASES.md, docs/DATABASE_SCHEMA.md,
   docs/NEXT_RELEASE.md) with message: "docs: phase $ARGUMENTS complete"

6. Tag the commit: `git tag -a phase-$ARGUMENTS -m "Phase $ARGUMENTS complete"`.
   Local tag only — do not `git push` the commit or the tag to GitHub. Pushing
   to GitHub and publishing a release only happen via `/release`.

7. Build and push the stage image: `bash scripts/publish-stage.sh`. This
   updates the `stage` tag on Docker Hub only — never touches
   `rtippenhauer/dinnerbears:latest` (prod), which is exclusively `/release`'s
   job.

8. Report back a short summary: files updated, local commit + tag created
   (not pushed), stage image rebuilt and pushed.

When done, run /clear.