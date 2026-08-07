Phase $ARGUMENTS is complete. 

0. Confirm the current branch is this phase's branch (`phase-$ARGUMENTS-*`), not `main`. If somehow on `main`, stop and ask Rob before committing anything — all phase work and its doc updates belong on the phase branch; the merge into `main` happens later in this same command (step 7), not before it.

   This command assumes `/phase-testing` has already put the phase on stage and
   Rob has confirmed it looks right. If that hasn't happened, say so and offer to
   run `/phase-testing` first rather than merging untested work — step 7 merges
   into `main`, which is the point of no return.

1. Provide a customer-friendly release note summary of everything completed.
   Append it to `docs/NEXT_RELEASE.md` under a heading for this phase's area
   (create the file from the template below if it doesn't exist yet). Don't
   remove or rewrite existing entries already in the file — only add to it.
   Write copy using the `{{points}}`/`{{locations}}`/`{{events}}` placeholder
   tokens instead of hardcoded DinnerBears wording, since this draft ships to
   every fork (see `docs/RELEASE_NOTE_PIPELINE_SPEC.md`). This step itself is
   still just a draft accumulator — it doesn't touch the `releases` table or
   any production API directly — but the stage image rebuilt in step 8 below
   ships this updated draft, and a boot-time importer
   (`ReleaseNotesImporterService`) automatically publishes it to stage's
   `/updates` page once that container restarts (gated on `IS_STAGE=true` —
   it never surfaces on prod until `/release` finalizes it). No separate
   publish action needed on Rob's part.

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

7. **Merge the phase branch into `main`:**
   - Push the branch: `git push -u origin <branch>`
   - Push the tag: `git push origin phase-$ARGUMENTS`
   - Open a PR into `main`: `gh pr create --title "<branch/phase description>" --body "<short summary of what's in it>"`
   - Merge with a real merge commit — never squash or rebase, so the branch's
     individual commits and the `phase-<N>` tag stay reachable from `main`'s
     history: `gh pr merge --merge --delete-branch`
   - `git checkout main && git pull origin main`, then delete the local
     branch if it wasn't already removed: `git branch -d <branch>`

8. Build and push the stage image: `bash scripts/publish-stage.sh`. This
   updates the `stage` tag on Docker Hub only — never touches
   `rtippenhauer/community-events:latest` (prod), which is exclusively
   `/release`'s job.

   If `/phase-testing` already pushed this phase to stage, this is **not** a
   second deploy of new code — it is a re-stamp. Two things genuinely changed:
   the merge commit is now `main`'s HEAD (and the footer displays the running
   commit, so stage would otherwise report a commit that no longer exists on any
   branch), and step 1's `docs/NEXT_RELEASE.md` entry ships in
   `release-notes/_draft.md` for the first time, which is what surfaces this
   phase on stage's `/updates` page. Tell Rob a container restart is still
   required for either to take effect.

9. Report back a short summary: files updated, commit + tag created, PR
   merged into `main`, stage image rebuilt and pushed.

When done, run /clear.