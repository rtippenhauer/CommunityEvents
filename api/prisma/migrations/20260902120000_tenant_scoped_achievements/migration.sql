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

-- 3. Every other community gets its own copy of that catalogue.
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

-- 4. Re-point earned badges at the granting community's own copy, matched by
--    `key` -- which is stable across communities precisely because it is an
--    identifier and not copy.
UPDATE `member_achievements` ma
  JOIN `achievements` old ON old.`id` = ma.`achievement_id`
  JOIN `achievements` mine
    ON mine.`key` = old.`key` AND mine.`tenant_id` = ma.`tenant_id`
  SET ma.`achievement_id` = mine.`id`
  WHERE ma.`tenant_id` <> old.`tenant_id`;

-- 5. The same for the points ledger. `member_points.reference_id` holds an
--    achievement id when `point_type = 'achievement'`, with no foreign key to
--    enforce it -- so nothing would have complained had this been missed, and
--    the leaderboard would have silently credited another community's row.
UPDATE `member_points` mp
  JOIN `achievements` old ON old.`id` = mp.`reference_id`
  JOIN `achievements` mine
    ON mine.`key` = old.`key` AND mine.`tenant_id` = mp.`tenant_id`
  SET mp.`reference_id` = mine.`id`
  WHERE mp.`point_type` = 'achievement' AND mp.`tenant_id` <> old.`tenant_id`;

-- 6. Two keys carried DinnerBears branding in an identifier. They are joined on
--    in code (adminBackfillFounders, merch.service, the splash component), so
--    they are renamed in lockstep with those constants.
UPDATE `achievements` SET `key` = 'founding_member' WHERE `key` = 'founding_bear';
UPDATE `achievements` SET `key` = 'patriotic_2026'  WHERE `key` = 'patriotic_bear';

-- 7. `key` alone is no longer unique -- every community holds its own row for
--    the same key -- so the old index is replaced by the compound one.
DROP INDEX `uq_achievements_key` ON `achievements`;
CREATE UNIQUE INDEX `uq_achievements_tenant_key` ON `achievements` (`tenant_id`, `key`);
CREATE INDEX `idx_achievements_tenant` ON `achievements` (`tenant_id`);

-- 8. RESTRICT, matching every other tenant key: deleting a community must fail
--    loudly if the purge in tenants-admin.service ever stops covering this
--    table, rather than orphaning its catalogue.
ALTER TABLE `achievements`
  ADD CONSTRAINT `fk_achievements_tenant`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
