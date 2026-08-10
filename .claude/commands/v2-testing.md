v2 item $ARGUMENTS is ready for testing on the v2 stage image.

This command targets a **separate Docker tag**: `rtippenhauer/community-events:v2-stage`,
never `:stage` or `:latest` — those belong to the old repo's v1 deploy
pipeline and this repo must never touch them (see CLAUDE.md's intro).
There is no v2 prod tag yet — that only happens at the actual 2.0 cutover.

This is the step *before* `/v2-done`: it puts the item's code on the v2 stage
image so Rob can exercise it for real, while the branch is still unmerged and
cheap to fix. Nothing here touches `main`, tags, docs, or the version — those
are `/v2-done`'s job, and they only run once v2-stage looks right.

0. Confirm the current branch is this item's branch (`v2-$ARGUMENTS-*`, or the
   `feature-<slug>` / `bugfix-<slug>` branch the work actually lives on) — not
   `main`. If on `main`, stop and ask Rob: the work is already merged, so there
   is nothing to test in isolation.

   If $ARGUMENTS is empty, don't invent an item number — it ends up in a
   permanent tag and in `V2_PHASES.md` later. Either ask Rob for it, or, if
   this work isn't a numbered v2 item at all, just proceed using the branch
   name and leave the numbering to `/v2-done`.

1. Confirm the working tree is clean (`git status`) and the branch is pushed
   (`git push -u origin <branch>`). **The stage image is built from the
   working tree, not from git** — building with uncommitted changes ships
   code that exists in no commit. Never build dirty.

2. Run the project's current test suite before it reaches a container.
   **Check `api/package.json` and `frontend/package.json` scripts rather
   than assuming — the toolchain is mid-migration.** Through v2-1 (the
   Prisma swap), `api/` still runs on Jest and `scripts/test-db-up.sh`
   still applies; from v2-2 (the testing stack swap) onward, expect Vitest
   + Supertest and Playwright per
   `docs/REQ-TENANT-01.md`'s testing requirements, and the exact commands
   here will need updating once that lands — don't trust this file blindly,
   confirm against what's actually wired up.

   Build **production**, not development, for the frontend build check —
   the Dockerfile builds production, and only production applies budgets
   and optimizations that development skips.

   Report failures honestly rather than waving them through. Before
   attributing any failure to this item, check it against clean `main`
   (`git stash`, run, `git stash pop`).

3. Build and push the v2 stage image: `bash scripts/publish-v2-stage.sh`.
   This updates the `v2-stage` tag on Docker Hub only. The image is stamped
   with the branch's HEAD commit, which is what the app footer displays.

   If the build dies at the frontend step with a bare `exit code 1` and no
   Angular error above it, suspect an OOM kill before the code. Confirm with
   `docker info | grep -i "total memory"`, stop the test DB, retry.

4. Verify the pushed image is what you think it is:
   `docker run --rm --entrypoint sh rtippenhauer/community-events:v2-stage -c 'echo $GIT_COMMIT'`
   and confirm it matches `git rev-parse HEAD`.

5. Report back:
   - Image tag, digest, and the commit it's stamped with.
   - **Rob must point a container at `:v2-stage` and restart it manually —
     pushing the image does not deploy it, and unlike v1 there may not be a
     standing container already tracking this tag.** Confirm with Rob how
     v2-stage is being run before assuming a restart is all that's needed.
   - **Testing notes**: a concrete, ordered checklist of what to exercise,
     derived from what this item actually changed. Call out what you could
     *not* verify yourself and why.
   - This item's changes have **not** reached `docs/NEXT_RELEASE_V2.md` yet —
     that's `/v2-done` step 1.

Fixes for anything found during testing go on the same branch, then re-run
`/v2-testing` to push an updated image. Run `/v2-done` only once Rob confirms
v2-stage looks right — it merges into `main`, the point of no return.
