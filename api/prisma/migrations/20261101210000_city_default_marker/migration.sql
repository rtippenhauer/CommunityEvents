-- v2-24: an explicit default city per community.
--
-- Replaces two implicit answers that disagreed: the enable backfill filed
-- everything under the lowest *id*, and a brand-new member landed in the
-- lowest *name*. Neither was a choice anybody made, and renaming a city
-- silently moved one of them.
--
-- `is_default` is a marker, not a boolean: only ever 1 or NULL. MySQL has no
-- partial unique index but allows repeated NULLs in a unique one, so the
-- composite below is what makes "at most one default per community" a
-- constraint. Writing 0 would make that value unique per community too.
ALTER TABLE `cities` ADD COLUMN `is_default` TINYINT(1) NULL;

-- Every existing community keeps the behaviour it had: the enable backfill's
-- lowest-id active city becomes the explicit default. A community whose
-- cities are all retired gets none, and resolution falls back as before.
--
-- Runs BEFORE the unique index purely so a surprise in the data fails on the
-- UPDATE, where the message names the table, rather than on index creation.
UPDATE `cities` c
JOIN (
  SELECT `tenant_id`, MIN(`id`) AS `id`
  FROM `cities`
  WHERE `is_active` = 1
  GROUP BY `tenant_id`
) f ON f.`tenant_id` = c.`tenant_id` AND f.`id` = c.`id`
SET c.`is_default` = 1;

CREATE UNIQUE INDEX `uq_city_tenant_default` ON `cities`(`tenant_id`, `is_default`);
