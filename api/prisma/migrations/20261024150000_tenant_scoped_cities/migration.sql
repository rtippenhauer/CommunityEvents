-- Tenant-scope cities, drop subdomain-as-host, and replace the single-valued
-- city filter with a multi-select set (v2-24, REQ-CITIES-01).
--
-- `cities` was the one model the v2-6 scoping pass never touched. That left a
-- live cross-tenant write hole rather than only a design gap: the admin
-- controller is `@Roles(ADMIN)` over a global table with no tenant filter, so
-- any community's admin could list every community's cities, rename or
-- deactivate one another community depended on, and claim a `subdomain`
-- globally because its unique index spanned the whole table.
--
-- **Statement order is not arbitrary, and the reason is v2-10's.** The
-- catalogue is fanned out per tenant, so the unique index has to be in its
-- final shape BEFORE anything is copied -- copying is precisely what makes a
-- name appear twice. v2-10's achievements migration did the copy first and died
-- on `Duplicate entry` against any database holding a non-root tenant, which
-- the suite could not catch because the e2e harness builds an empty database
-- where the copy selects zero rows.
--
-- Everything here is a no-op on a fresh database: `migrate deploy` runs before
-- both `seed.js` and `bootstrap.js`, so there are no tenants and no cities yet.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Facebook groups go entirely.
--
--    Meta's API already blocks automated group posting, so the structure served
--    a capability that barely worked. The `campaign_facebook` invite *type*
--    survives -- it drives `users.invite_source`, which is attribution, not a
--    group id -- so only the foreign key and the table go.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE `invites` DROP FOREIGN KEY `fk_invite_fbgroup`;
DROP INDEX `idx_facebook_group` ON `invites`;
ALTER TABLE `invites` DROP COLUMN `facebook_group_id`;
DROP TABLE `facebook_group_config`;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. `subdomain` goes with its globally-unique index.
--
--    A city is a row, not a hostname (Rob, 2026-10-14). The column made a city
--    a web host, nobody used it, and the index was the mechanism by which one
--    community could take a name from every other.
--
--    Dropping it here also removes the obstacle the fan-out below would
--    otherwise hit: a copied row cannot carry a globally-unique value.
-- ───────────────────────────────────────────────────────────────────────────
DROP INDEX `uq_subdomain` ON `cities`;
ALTER TABLE `cities` DROP COLUMN `subdomain`;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The column, with the same DEFAULT 0 sentinel every other scoped table
--    uses. The foreign key at step 8 is what makes an unscoped write fail at
--    the database rather than silently landing on tenant zero.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE `cities`
  ADD COLUMN `tenant_id` INT UNSIGNED NOT NULL DEFAULT 0;

-- 4. The existing rows become the root tenant's, as a JOIN so it is a harmless
--    no-op on a database with no tenants.
UPDATE `cities` c
  JOIN `tenants` t ON t.`is_root` = 1
  SET c.`tenant_id` = t.`id`
  WHERE c.`tenant_id` = 0;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Make the name unique within the tenant, which it was not before.
--
--    `name` carried no unique index at all while `subdomain` did, so two rows
--    could legitimately share a name today. They are disambiguated rather than
--    merged: merging would silently repoint one city's history onto another,
--    and this is a case that wants a human to look at it. The id in the new
--    name is what makes it findable.
--
--    The index is created here, before the copy, for the reason in the header.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE `cities` c
  JOIN (
    SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `tenant_id`, `name` ORDER BY `id`) AS rn
    FROM `cities`
  ) d ON d.`id` = c.`id`
  SET c.`name` = CONCAT(LEFT(c.`name`, 90), ' (', c.`id`, ')')
  WHERE d.rn > 1;

CREATE UNIQUE INDEX `uq_city_tenant_name` ON `cities` (`tenant_id`, `name`);
CREATE INDEX `idx_cities_tenant` ON `cities` (`tenant_id`);

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Every other community gets its own copy of the cities it actually uses.
--
--    Deliberately *only* the ones it references, where v2-10 copied the whole
--    achievement catalogue. An achievement catalogue is reference data every
--    community is expected to have; a city list is one community's own
--    geography, and handing each community a copy of every other's city names
--    would be the same disclosure the report board goes to lengths to avoid.
--
--    `is_active` is carried over rather than forced on: a city the root tenant
--    had retired is one this community had retired too, since until now there
--    was only one row.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO `cities` (`name`, `is_active`, `created_at`, `tenant_id`)
SELECT c.`name`, c.`is_active`, c.`created_at`, t.`id`
FROM `tenants` t
  JOIN `tenants` root ON root.`is_root` = 1
  JOIN `cities` c ON c.`tenant_id` = root.`id`
WHERE t.`is_root` = 0
  AND (
    EXISTS (SELECT 1 FROM `users`         u WHERE u.`tenant_id` = t.`id` AND u.`city_id` = c.`id`)
    OR EXISTS (SELECT 1 FROM `events`        e WHERE e.`tenant_id` = t.`id` AND e.`city_id` = c.`id`)
    OR EXISTS (SELECT 1 FROM `locations`     l WHERE l.`tenant_id` = t.`id` AND l.`city_id` = c.`id`)
    OR EXISTS (SELECT 1 FROM `announcements` a WHERE a.`tenant_id` = t.`id` AND a.`city_id` = c.`id`)
    OR EXISTS (SELECT 1 FROM `invites`       i WHERE i.`tenant_id` = t.`id` AND i.`city_id` = c.`id`)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Re-point every referencing row at its own community's copy, matched by
--    name -- which is stable across the copy because the copy is what created
--    the duplicate names in the first place.
--
--    The `WHERE tenant_id <> old.tenant_id` arm is what leaves the root
--    tenant's own rows alone: they already point at the originals, which are
--    now root's.
--
--    Five tables, which is every table carrying `city_id`. The count is checked
--    at runtime from the Prisma DMMF rather than trusted from here -- see
--    `city-relations.ts`, which refuses to boot if a sixth appears.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE `users` u
  JOIN `cities` old ON old.`id` = u.`city_id`
  JOIN `cities` mine ON mine.`name` = old.`name` AND mine.`tenant_id` = u.`tenant_id`
  SET u.`city_id` = mine.`id`
  WHERE u.`tenant_id` <> old.`tenant_id`;

UPDATE `events` e
  JOIN `cities` old ON old.`id` = e.`city_id`
  JOIN `cities` mine ON mine.`name` = old.`name` AND mine.`tenant_id` = e.`tenant_id`
  SET e.`city_id` = mine.`id`
  WHERE e.`tenant_id` <> old.`tenant_id`;

UPDATE `locations` l
  JOIN `cities` old ON old.`id` = l.`city_id`
  JOIN `cities` mine ON mine.`name` = old.`name` AND mine.`tenant_id` = l.`tenant_id`
  SET l.`city_id` = mine.`id`
  WHERE l.`tenant_id` <> old.`tenant_id`;

UPDATE `announcements` a
  JOIN `cities` old ON old.`id` = a.`city_id`
  JOIN `cities` mine ON mine.`name` = old.`name` AND mine.`tenant_id` = a.`tenant_id`
  SET a.`city_id` = mine.`id`
  WHERE a.`tenant_id` <> old.`tenant_id`;

UPDATE `invites` i
  JOIN `cities` old ON old.`id` = i.`city_id`
  JOIN `cities` mine ON mine.`name` = old.`name` AND mine.`tenant_id` = i.`tenant_id`
  SET i.`city_id` = mine.`id`
  WHERE i.`tenant_id` <> old.`tenant_id`;

-- 8. RESTRICT, matching every other tenant key: deleting a community must fail
--    loudly if the purge ever stops covering this table.
ALTER TABLE `cities`
  ADD CONSTRAINT `fk_cities_tenant`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Every `city_id` becomes nullable.
--
--    Two independent reasons, either of which would be sufficient. The feature
--    toggle cannot be validation-only while the database requires a value --
--    with cities off, nothing can supply one. And turning the toggle off clears
--    `city_id` on future events, all locations and all users, which a NOT NULL
--    column cannot express.
--
--    The requirement itself moves to the business layer, which is the only
--    layer that knows the tenant's flag.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE `events`    MODIFY COLUMN `city_id` INT UNSIGNED NULL;
ALTER TABLE `locations` MODIFY COLUMN `city_id` INT UNSIGNED NULL;
ALTER TABLE `users`     MODIFY COLUMN `city_id` INT UNSIGNED NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 10. The multi-select preference set.
--
--     `ON DELETE CASCADE` on the user, because a preference is meaningless
--     without the member holding it -- unlike every other `city_id`, which is
--     `NoAction` so an unplanned city delete fails loudly.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE `user_city_preferences` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `city_id`    INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id`  INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_ucp_user_city` (`user_id`, `city_id`),
  INDEX `fk_ucp_city` (`city_id`),
  INDEX `idx_ucp_tenant` (`tenant_id`),
  CONSTRAINT `fk_ucp_user`   FOREIGN KEY (`user_id`)   REFERENCES `users` (`id`)   ON DELETE CASCADE  ON UPDATE NO ACTION,
  CONSTRAINT `fk_ucp_city`   FOREIGN KEY (`city_id`)   REFERENCES `cities` (`id`)  ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_ucp_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT  ON UPDATE NO ACTION
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;

-- ───────────────────────────────────────────────────────────────────────────
-- 11. Backfill the set from the two enums it replaces, then drop them.
--
--     A row is written when EITHER `calendar_city_filter = 'city'` OR
--     `calendar_auto_invite = 'city'`, because one set now answers both
--     questions and those two could disagree.
--
--     **The disagreeing case loses something either way, and this picks which.**
--     A member on `filter = all` + `auto_invite = city` saw every city's events
--     and was invited only to their own. Writing no row would widen their
--     invites to every city; writing one narrows their feed to one city. The
--     narrowing is chosen because it is visible and reversible at a screen that
--     names the city in its own label, where unwanted invites arrive in
--     somebody's inbox and cannot be recalled.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO `user_city_preferences` (`user_id`, `city_id`, `tenant_id`, `created_at`)
SELECT u.`id`, u.`city_id`, u.`tenant_id`, NOW()
FROM `users` u
WHERE u.`city_id` IS NOT NULL
  AND (u.`calendar_city_filter` = 'city' OR u.`calendar_auto_invite` = 'city');

-- `calendar_auto_invite` narrows from `none | city | all` to an on/off: which
-- cities it covers is the table above now, so the two "on" arms collapse.
ALTER TABLE `users` ADD COLUMN `calendar_auto_invite_flag` TINYINT(1) NOT NULL DEFAULT 0;
UPDATE `users` SET `calendar_auto_invite_flag` = IF(`calendar_auto_invite` = 'none', 0, 1);
ALTER TABLE `users` DROP COLUMN `calendar_auto_invite`;
ALTER TABLE `users` CHANGE COLUMN `calendar_auto_invite_flag` `calendar_auto_invite` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `users` DROP COLUMN `calendar_city_filter`;

-- ───────────────────────────────────────────────────────────────────────────
-- 12. Turn `feature_cities` on where it is already true in practice.
--
--     The flag defaults OFF in code, which is right for a brand-new community
--     and wrong for one already meeting in more than one place. "Already using
--     cities" is read as **two or more distinct cities referenced** by the
--     community's own events, locations or users -- not merely "has a city
--     row", because `users.city_id` was NOT NULL until nine statements ago, so
--     every community has one whether or not it means anything.
--
--     A single-city community keeps its rows and its one city; they are simply
--     invisible until an admin turns the feature on, which backfills nothing
--     because nothing is null.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO `app_config` (`config_key`, `config_value`, `description`, `tenant_id`, `updated_at`)
SELECT 'feature_cities', 'true', 'Filter events by city (migrated: already using more than one)', t.`id`, NOW()
FROM `tenants` t
WHERE (
  SELECT COUNT(DISTINCT city_id) FROM (
    SELECT e.`city_id` AS city_id FROM `events`    e WHERE e.`tenant_id` = t.`id` AND e.`city_id` IS NOT NULL
    UNION     SELECT l.`city_id`        FROM `locations` l WHERE l.`tenant_id` = t.`id` AND l.`city_id` IS NOT NULL
    UNION     SELECT u.`city_id`        FROM `users`     u WHERE u.`tenant_id` = t.`id` AND u.`city_id` IS NOT NULL
  ) used
) >= 2
ON DUPLICATE KEY UPDATE `config_value` = 'true';
