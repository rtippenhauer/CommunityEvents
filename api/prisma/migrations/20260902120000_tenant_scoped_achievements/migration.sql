-- Tenant-scope the achievement catalogue (v2-10).
--
-- `achievements` was global reference data seeded once, so every community
-- shared one catalogue -- and that catalogue held DinnerBears' copy, which no
-- other community could override because the rows were not theirs.
--
-- The delicate part is not the column, it is the two places that reference an
-- achievement id: `member_achievements.achievement_id` (a real foreign key) and
-- `member_points.reference_id` (a plain int, no FK, set by
-- AchievementsService.grant). Both hold ids that were valid when one catalogue
-- served everyone. Fanning the catalogue out per tenant without re-pointing
-- them would leave members' earned badges pointing at another community's rows.
--
-- **Statement order matters and is not arbitrary.** The unique index has to be
-- swapped from (`key`) to (`tenant_id`, `key`) BEFORE the catalogue is copied
-- per tenant, because the whole point of the copy is that the same `key` now
-- appears once per community. The first version of this migration did the copy
-- first and died on `Duplicate entry 'first_dinner' for key
-- 'achievements.uq_achievements_key'` against any database that had a non-root
-- tenant -- which the test suite never caught, because it builds an empty
-- database where the copy selects zero rows and the constraint is never tested.

-- 1. The column, with the same DEFAULT 0 sentinel every other scoped table uses.
--    The foreign key added at the end is what makes an unscoped write fail at
--    the database rather than silently landing on tenant zero.
ALTER TABLE `achievements`
  ADD COLUMN `tenant_id` INT UNSIGNED NOT NULL DEFAULT 0;

-- 2. The existing rows become the root tenant's. Written as a JOIN rather than
--    a subquery so it is a harmless no-op on a fresh database, which has no
--    tenants yet and no achievements either -- `migrate deploy` runs before
--    both `seed.js` and `bootstrap.js`.
UPDATE `achievements` a
  JOIN `tenants` t ON t.`is_root` = 1
  SET a.`tenant_id` = t.`id`
  WHERE a.`tenant_id` = 0;

-- 3. Swap the unique key BEFORE copying anything. `key` alone stops being
--    unique here: every community holds its own row for the same key, which is
--    exactly what step 4 is about to create. At this point every row still
--    belongs to the root tenant, so the new compound index is satisfiable.
DROP INDEX `uq_achievements_key` ON `achievements`;
CREATE UNIQUE INDEX `uq_achievements_tenant_key` ON `achievements` (`tenant_id`, `key`);
CREATE INDEX `idx_achievements_tenant` ON `achievements` (`tenant_id`);

-- 4. Every other community gets its own copy of that catalogue.
--
--    `event_id` is deliberately NULLed in the copies. It references `events`,
--    which is tenant-scoped, so carrying the root tenant's event id into
--    another community would point one community's achievement at another
--    community's event -- an inconsistency the global table allowed and this
--    migration must not preserve.
INSERT INTO `achievements`
  (`key`, `name`, `description`, `icon`, `image_path`, `progress_type`,
   `progress_target`, `event_id`, `points`, `title`, `is_secret`, `created_at`,
   `tenant_id`)
SELECT
  a.`key`, a.`name`, a.`description`, a.`icon`, a.`image_path`, a.`progress_type`,
  a.`progress_target`, NULL, a.`points`, a.`title`, a.`is_secret`, a.`created_at`,
  t.`id`
FROM `achievements` a
  JOIN `tenants` root ON root.`is_root` = 1 AND a.`tenant_id` = root.`id`
  JOIN `tenants` t ON t.`is_root` = 0;

-- 5. Re-point earned badges at the granting community's own copy, matched by
--    `key` -- which is stable across communities precisely because it is an
--    identifier and not copy.
UPDATE `member_achievements` ma
  JOIN `achievements` old ON old.`id` = ma.`achievement_id`
  JOIN `achievements` mine
    ON mine.`key` = old.`key` AND mine.`tenant_id` = ma.`tenant_id`
  SET ma.`achievement_id` = mine.`id`
  WHERE ma.`tenant_id` <> old.`tenant_id`;

-- 6. The same for the points ledger. `member_points.reference_id` holds an
--    achievement id when `point_type = 'achievement'`, with no foreign key to
--    enforce it -- so nothing would have complained had this been missed, and
--    the leaderboard would have silently credited another community's row.
UPDATE `member_points` mp
  JOIN `achievements` old ON old.`id` = mp.`reference_id`
  JOIN `achievements` mine
    ON mine.`key` = old.`key` AND mine.`tenant_id` = mp.`tenant_id`
  SET mp.`reference_id` = mine.`id`
  WHERE mp.`point_type` = 'achievement' AND mp.`tenant_id` <> old.`tenant_id`;

-- 7. Two keys carried DinnerBears branding in an identifier. They are joined on
--    in code (adminBackfillFounders, merch.service, the splash component), so
--    they are renamed in lockstep with those constants. Safe under the compound
--    unique key: each community holds exactly one row per key.
UPDATE `achievements` SET `key` = 'founding_member' WHERE `key` = 'founding_bear';
UPDATE `achievements` SET `key` = 'patriotic_2026'  WHERE `key` = 'patriotic_bear';

-- 8. RESTRICT, matching every other tenant key: deleting a community must fail
--    loudly if the purge in tenants-admin.service ever stops covering this
--    table, rather than orphaning its catalogue.
ALTER TABLE `achievements`
  ADD CONSTRAINT `fk_achievements_tenant`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
