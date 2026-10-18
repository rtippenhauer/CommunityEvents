# Working instructions for Codex

Rob and Claude decide which work items Codex takes. An item is Codex's only when
its `V2_PHASES.md` entry carries an **`**Agent:** Codex`** line. Everything else is
off limits, however small it looks. To change the list, Rob edits those lines.

## Picking the item

1. If Rob's prompt names an item, do that one.
2. Otherwise take the **first** item in `V2_PHASES.md` that has `**Agent:** Codex`,
   `**Status:** Not started`, and every item it depends on merged to `main`. If
   none qualifies, stop and say so. Don't pick something untagged.
3. One item per branch and per PR.

## Before starting

- Read `AGENTS.md`, the item's entry in `V2_PHASES.md`, the REQ section it cites,
  and these CLAUDE.md sections: "Stack", "Database", "Multi-Tenancy", "Angular
  Conventions", "NestJS Conventions", "Branching & Release Workflow".
- The item's **Definition of done** is the bar. If the spec conflicts with the
  existing code, stop and explain rather than guessing.

## Where you work

- A local git worktree at `C:\Users\rtipp\source\repos\CommunityEvents-codex`.
  Rob creates it per item:
  `git worktree add ..\CommunityEvents-codex -b v2-<N>-<slug> origin/main`.
  Stay in that folder and on that branch. Never touch `..\CommunityEvents`:
  another session works there on the DinnerBears cutover.
- If the branch isn't already checked out, create `v2-<N>-<slug>` off
  `origin/main`.

## Test database: never share it

The e2e MySQL is overridable by three variables (added in v2-36 Step 0; until
that is merged, add them as described there). In the Codex worktree, **always**
run e2e with:

```
TEST_STACK=communityevents-test-codex
TEST_DB_CONTAINER=communityevents-mysql-test-codex
TEST_DB_PORT=3308
```

Never stop, reset or remove `dinnerbears-mysql-test`. It belongs to the other
checkout.

## Tests

Run the API unit suite, the e2e suite (with the variables above) and the
frontend build. Any route returning tenant data needs e2e coverage with two
users in one tenant plus a user in another tenant. Report real results. If
something can't run, say so. Never claim a test passes that you didn't run.

## Rules

- Never build or push Docker images or tags. Don't run `scripts/publish-v2-stage.sh`.
- Don't change `V2_PHASES.md` status lines, `CLAUDE.md` or
  `docs/NEXT_RELEASE_V2.md`. Rob's `/v2-done` does that after review.
- No personal content or secrets. This is a public repository.
- Don't touch events, cities, Facebook, import or locations code unless the item
  says to.
- Commit in logical steps. When done, push the branch and open a PR to `main`
  with `gh pr create`. **Never merge.**

## PR description

What you built, the exact test commands you ran with pass/fail counts, anything
you couldn't run, and every decision you made that the spec didn't cover.

## v2-36 only — Step 0: isolate the e2e database

Do this first, as its own commit ("test: isolate the e2e database per checkout").
The e2e setup uses a fixed compose project name (`communityevents-test`),
container name (`dinnerbears-mysql-test`) and host port (`3307`). Make all three
overridable, keeping today's values as defaults so existing checkouts behave
identically:

- `docker/docker-compose.test.yml`: `name: ${TEST_STACK:-communityevents-test}`,
  `container_name: ${TEST_DB_CONTAINER:-dinnerbears-mysql-test}`,
  `ports: "${TEST_DB_PORT:-3307}:3306"`.
- `scripts/test-db-up.sh` and `scripts/run-e2e-tests.sh`: read the same
  variables with the same defaults, and pass `DB_PORT=$TEST_DB_PORT` to the test
  run. Teardown must only touch its own stack.
- `api/test/setup-env.ts` and `api/test/global-setup.ts`: keep honoring
  `DB_PORT`. Check the comment in `global-setup.ts` about the root `.env`
  overriding the environment, and make sure an overridden port actually reaches
  Prisma and the tests.
- Document the variables in a comment at the top of the compose file.
- The first time, confirm with `docker ps` that the run created its own
  container and left `dinnerbears-mysql-test` alone.
