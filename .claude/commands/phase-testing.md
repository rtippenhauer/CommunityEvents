Phase $ARGUMENTS is ready for testing on stage.

This is the step *before* `/phase-done`: it puts the phase's code on stage so Rob
can exercise it for real, while the branch is still unmerged and cheap to fix.
Nothing here touches `main`, tags, docs, or the version — those are `/phase-done`'s
job, and they only run once stage looks right.

0. Confirm the current branch is this phase's branch (`phase-$ARGUMENTS-*`, or the
   `feature-<slug>` / `bugfix-<slug>` branch the work actually lives on) — not
   `main`. If on `main`, stop and ask Rob: the work is already merged, so there is
   nothing to test in isolation and a stage push from `main` is a different
   (and usually unintended) action.

   If $ARGUMENTS is empty, don't invent a phase number — it ends up in a permanent
   tag and in the docs later. Either ask Rob for it, or, if this work isn't a
   numbered phase at all, just proceed using the branch name and leave the
   numbering to `/phase-done`.

1. Confirm the working tree is clean (`git status`) and the branch is pushed
   (`git push -u origin <branch>`). **The stage image is built from the working
   tree, not from git** — building with uncommitted changes ships code that exists
   in no commit, and the footer will then claim a commit that doesn't match what's
   running. Never build dirty.

2. Run the checks that are cheap and catch real breakage before it reaches a
   container:
   - API e2e: bring the test DB up with `bash scripts/test-db-up.sh --reset`,
     then `cd api && npx jest --config ./test/jest-e2e.json --runInBand`, and
     `docker compose -f docker/docker-compose.test.yml down` afterward (which
     also frees the memory the image build needs — see step 3).

     Use the script rather than `docker compose up -d` plus a `mysqladmin ping`
     loop. Ping is not a sufficient readiness check: on first-run init the MySQL
     image runs a temporary server that answers ping before root grants are
     final, so the next statement fails with `Access denied` and it looks
     random. The script probes the capability actually needed — authenticate and
     execute — and a fixed `sleep` would only move the race.
   - Frontend build: `cd frontend && npx ng build --configuration production`

   Build **production**, not development — the Dockerfile runs
   `npm run build -- --configuration production`, and production applies budgets
   and optimizations that development does not. Checking `development` here
   cannot catch a production-only failure, which defeats the point of running
   the check before the image build.

   Report failures honestly rather than waving them through. Before attributing
   any failure to this phase, check it against clean `main` (`git stash`, run,
   `git stash pop`) — there are known pre-existing failures in the `uploads`,
   `location-privacy`, and `calendar` specs, and quietly inheriting the blame for
   them is as bad as quietly hiding a real regression.

3. Build and push the stage image: `bash scripts/publish-stage.sh`. This updates
   the `stage` tag on Docker Hub only — never `rtippenhauer/community-events:latest`
   (prod), which is exclusively `/release`'s job. The image is stamped with the
   branch's HEAD commit, which is what the app footer displays.

   If the build dies at the frontend step with a bare `exit code 1` and no
   Angular error above it, suspect memory before suspecting the code — the Node
   process was most likely OOM-killed. Confirm with `docker info | grep -i "total
   memory"`; the Angular production build needs more headroom than a ~2GiB
   allotment leaves once another container is running. Stop the test DB
   (`docker compose -f docker/docker-compose.test.yml down`) and retry before
   digging into the diff. Re-running with `BUILDKIT_PROGRESS=plain` also keeps
   the real error visible, since BuildKit collapses it by default. A local
   `ng build --configuration production` that succeeds is strong evidence the
   failure is environmental rather than a code problem.

4. Verify the pushed image is what you think it is, rather than assuming the build
   picked up your changes:
   `docker run --rm --entrypoint sh rtippenhauer/community-events:stage -c 'echo $GIT_COMMIT'`
   and confirm it matches `git rev-parse HEAD`.

5. Report back:
   - Image tag, digest, and the commit it's stamped with.
   - **Rob must restart the stage container manually — pushing the image does not
     deploy it.** Say this explicitly every time. It is the single most common way
     a change gets "tested" while the old code is still running.
   - **Testing notes**: a concrete, ordered checklist of what to exercise on stage,
     derived from what this phase actually changed. Cover the happy path, the
     permission/role boundaries, and anything only verified locally. Most
     importantly, call out what you could *not* verify yourself and why — Rob's
     attention is the scarce resource, so point it at the genuinely unverified
     parts instead of re-checking what e2e tests already cover.
   - Anything that will look different on stage for reasons unrelated to the
     phase — e.g. the `/updates` draft note does **not** yet include this phase;
     `docs/NEXT_RELEASE.md` is written by `/phase-done` step 1 and only reaches
     stage on the rebuild in `/phase-done` step 8.

Fixes for anything found during testing go on the same branch, then re-run
`/phase-testing` to push an updated image. Run `/phase-done` only once Rob
confirms stage looks right — it is the point of no return for `main`.
