-- Feature requests join bugs on the global board (Rob, 2026-10-04):
-- "Feature request and bug reports should be global and only general comments
-- should be tenant scoped."
--
-- **This had to be a table boundary and could not be a flag.** `feedback` is in
-- TENANT_SCOPED_MODELS, and the Prisma extension scopes a model wholly or not
-- at all -- there is no per-row choice, by design, because a predicate that
-- applied to some rows of a table and not others is exactly the kind of
-- isolation nobody can verify by reading a query. So the split is which table a
-- report lives in: `system_reports` is global, `feedback` stays scoped.
--
-- The table is renamed because it is no longer only bugs. `category` defaults
-- to `bug`, which is correct for every row that existed before this column did.
--
-- **Existing `feedback` rows are deliberately NOT moved.** Their authors wrote
-- them inside a community, for that community's admins, before any of this
-- existed; migrating them would retroactively widen the audience of writing
-- that was never offered a choice about it. They stay where they are and stay
-- readable there. Only new reports take the new route, where the form says in
-- as many words who will read it.

RENAME TABLE `system_bugs` TO `system_reports`;

ALTER TABLE `system_reports`
  ADD COLUMN `category` ENUM('bug', 'feature_request') NOT NULL DEFAULT 'bug' AFTER `id`,
  ADD INDEX `idx_system_report_category` (`category`);
