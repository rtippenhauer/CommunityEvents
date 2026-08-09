v2 item $ARGUMENTS is complete.

This is this repo's only "wrap up and merge" command — v1's `/phase-done`
lives in the old repo and doesn't apply here (see CLAUDE.md's intro). It
writes to this repo's own tracking files (`V2_PHASES.md`,
`docs/NEXT_RELEASE_V2.md`) and publishes to the `v2-stage` Docker tag only.
Merging is a real merge commit into `main` — confirmed with Rob that v2
doesn't get its own long-lived integration branch, since this repo is
already dedicated to v2.

0. Confirm the current branch is this item's branch (`v2-$ARGUMENTS-*`), not
   `main`. If somehow on `main`, stop and ask Rob before committing anything.

   This command assumes `/v2-testing` has already put the item on `v2-stage`
   and Rob has confirmed it looks right. If that hasn't happened, say so and
   offer to run `/v2-testing` first rather than merging untested work — step 7
   merges into `main`, which is the point of no return.

1. Provide a customer-friendly release note summary of everything completed.
   Append it to `docs/NEXT_RELEASE_V2.md` under a heading for this item's
   area (create the file from the template in that file if it's somehow
   missing). Don't remove or rewrite existing entries — only add to it. This
   is a running v2 draft only; there is no `/v2-release` yet, and no v2 tag
   gets built from it until Rob explicitly asks for one. He'll trim this
   down by hand into the real 2.0 release notes at cutover.

2. Update CLAUDE.md:
   - Move the current item into the "Completed v2 Items" section
   - Update "Current v2 Work Item" (under "V2 Rewrite Status") to the next
     item with a one-sentence summary, or "none — see V2_PHASES.md for the
     backlog" if nothing's queued
   - If this item changed the stack/conventions/DB rules (e.g. `v2-1`
     landing Prisma), update the relevant sections ("Inherited Stack",
     "NestJS Conventions", "Database") to reflect the new reality instead of
     describing it as still-pending

3. Update `V2_PHASES.md`:
   - Mark the finished item's status "Complete"
   - Mark the next backlog item "In Progress" if one is queued

4. Update `docs/DATABASE_SCHEMA.md` **only if this item didn't yet introduce
   `schema.prisma`** (i.e. only through v2-1). Once `schema.prisma` exists,
   it is the source of truth per REQ-TENANT-01.3 — `docs/DATABASE_SCHEMA.md`
   updates past that point are a nice-to-have for human readability, not a
   correctness requirement, and skipping them isn't a doc gap worth blocking
   on.

5. Commit the changed files (CLAUDE.md, `V2_PHASES.md`,
   `docs/NEXT_RELEASE_V2.md`, and `docs/DATABASE_SCHEMA.md` if touched) with
   message: "docs: v2 item $ARGUMENTS complete"

6. Tag the commit: `git tag -a v2-$ARGUMENTS -m "v2 item $ARGUMENTS complete"`.

7. **Merge the branch into `main`:**
   - Push the branch: `git push -u origin <branch>`
   - Push the tag: `git push origin v2-$ARGUMENTS`
   - Open a PR into `main`: `gh pr create --title "<branch/item description>" --body "<short summary of what's in it>"`
   - Merge with a real merge commit — never squash or rebase, so the
     branch's individual commits and the `v2-<N>` tag stay reachable from
     `main`'s history: `gh pr merge --merge --delete-branch`
   - `git checkout main && git pull origin main`, then delete the local
     branch if it wasn't already removed: `git branch -d <branch>`

8. Build and push the v2 stage image: `bash scripts/publish-v2-stage.sh`.
   This updates the `v2-stage` tag on Docker Hub only — this repo has no
   script capable of touching `:stage`/`:latest`, and that's intentional
   (those belong to the old repo's v1 pipeline).

   If `/v2-testing` already pushed this item to `v2-stage`, this is a
   re-stamp, not a second deploy: the merge commit is now `main`'s HEAD, and
   step 1's `docs/NEXT_RELEASE_V2.md` entry ships in the image for the first
   time. Tell Rob a container restart is still required for either to take
   effect (see the standing-container caveat in `/v2-testing`).

9. Report back a short summary: files updated, commit + tag created, PR
   merged into `main`, v2-stage image rebuilt and pushed.

When done, run /clear.
