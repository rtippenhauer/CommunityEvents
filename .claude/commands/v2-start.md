Start v2 work item $ARGUMENTS.

$ARGUMENTS is the v2 item number and a short description (e.g. "1 Prisma data layer"). If empty, use `V2_PHASES.md`'s next "Not started" item and CLAUDE.md's "Current v2 Work Item" line — that's set by the previous `/v2-done` run.

This repo doesn't carry v1's phase tooling or numbering — v1 development happens in a separate old repo entirely (see CLAUDE.md's intro). This command is this repo's only branch-cutting workflow.

1. Run `git status`. If there are uncommitted changes, stop and ask before proceeding — don't carry stray work onto the new branch.
2. Make sure trunk is current: `git checkout main && git pull origin main`.
3. Create and check out a new branch off `main` named `v2-<number>-<kebab-case-slug>` (e.g. `v2-1-prisma-swap`), derived from the item description. Do not push it yet — it's pushed for the first time in `/v2-testing`, when the item is ready to go to the v2 stage image.
4. Report back the branch name and confirm it's checked out, note the item's Definition of Done from `V2_PHASES.md`, and note that the item ends with `/v2-testing` (v2-stage + Rob's testing pass) and then `/v2-done` (merge).

No doc updates or commits happen in this command — `V2_PHASES.md`/CLAUDE.md were already updated by the prior `/v2-done`. This command only stages the branch; the item's actual work starts next.
