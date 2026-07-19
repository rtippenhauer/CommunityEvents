Start phase $ARGUMENTS.

$ARGUMENTS is the phase number and a short description (e.g. "25 Angular 19-22 upgrade"). If empty, use CLAUDE.md's "Current Development Phase" line — that's set by the previous `/phase-done` run.

1. Run `git status`. If there are uncommitted changes, stop and ask before proceeding — don't carry stray work onto the new branch.
2. Make sure trunk is current: `git checkout main && git pull origin main`. This should already reflect the previous phase's merge, since `/phase-done` now merges the finished phase branch into `main` itself.
3. Create and check out a new branch off `main` named `phase-<number>-<kebab-case-slug>` (e.g. `phase-25-angular-19-22-upgrade`), derived from the phase description. Do not push it yet — it's pushed for the first time in `/release`, when the phase is ready to merge.
4. Report back the branch name and confirm it's checked out.

No doc updates or commits happen in this command — CLAUDE.md/PHASES.md were already updated by the prior `/phase-done`. This command only stages the branch; the phase's actual work starts next.
