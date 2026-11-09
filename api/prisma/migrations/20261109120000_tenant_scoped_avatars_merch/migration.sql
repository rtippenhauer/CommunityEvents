-- Tenant-scope `avatar` and `merch_config` (v2-47).
--
-- These were the last two models in `GLOBAL_MODELS`' category (2), "reference
-- data `seed.ts` wrote". That category described *when a row is created*, not
-- who owns it: the seed runs before any tenant exists, so everything it writes
-- looks deployment-wide whether or not it is. `app_config` and `users` left the
-- category in v2-6 and `cities` in v2-24; this empties it.
--
-- Both carried a live cross-tenant write hole, not merely a design gap.
-- `/admin/avatars` is `@Roles(ADMIN)` over a table with no tenant filter, so
-- one community's admin added and removed presets every other community saw.
-- `merch_config` was a singleton pinned to id 1, so `store_url` and
-- `founding_bear_product_url` pointed every community at DinnerBears' shop and
-- any community's admin could repoint it for all of them.
--
-- **Statement order follows v2-24's lesson.** The unique index reaches its
-- final shape BEFORE anything is copied, because copying is what makes a path
-- appear twice. v2-10's achievements migration copied first and died on
-- `Duplicate entry` against any database holding a non-root tenant -- which the
-- suite cannot catch, because the e2e harness builds an empty database where
-- every copy below selects zero rows.
--
-- On a fresh install everything here is a no-op: `migrate deploy` runs before
-- `seed.js` and `bootstrap.js`, so there are no tenants and no rows yet.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The column, with the same DEFAULT 0 sentinel every other scoped table
--    uses. The foreign key at step 6 is what turns an unscoped write into a
--    database error rather than a row quietly landing on tenant zero.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE `avatar`
  ADD COLUMN `tenant_id` INT UNSIGNED NOT NULL DEFAULT 0;

-- 2. Existing presets become the root tenant's, as a JOIN so it is a harmless
--    no-op on a database with no tenants.
UPDATE `avatar` a
  JOIN `tenants` t ON t.`is_root` = 1
  SET a.`tenant_id` = t.`id`
  WHERE a.`tenant_id` = 0;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. `path` becomes unique per community instead of globally.
--
--    No de-duplication step is needed, unlike v2-24's `name`: `uq_avatar_path`
--    was already globally unique, so once every row belongs to one tenant the
--    compound index holds by construction.
--
--    The global index is the constraint that made the same shipped file
--    unclaimable by a second community -- `/avatars/bear-wizard.png` ships in
--    the frontend image and belongs to none of them.
-- ───────────────────────────────────────────────────────────────────────────
DROP INDEX `uq_avatar_path` ON `avatar`;
CREATE UNIQUE INDEX `uq_avatar_tenant_path` ON `avatar` (`tenant_id`, `path`);
CREATE INDEX `idx_avatar_tenant` ON `avatar` (`tenant_id`);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Every other community gets a copy of the presets its own members are
--    actually wearing.
--
--    Deliberately only those, the same choice v2-24 made for cities: handing
--    each community a copy of every preset on the deployment would re-create
--    the problem this migration exists to remove, one table row per tenant at
--    a time.
--
--    Matched on `users.profile_photo_path`, which holds a path **string** and
--    not a foreign key onto this table. That is also why no member's picture
--    can break here: the file is untouched by anything in this migration, and
--    an uncopied preset costs the member the ability to re-pick it, not the
--    photo they already have. This step buys back exactly that ability.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO `avatar` (`path`, `label`, `sort_order`, `created_at`, `tenant_id`)
SELECT a.`path`, a.`label`, a.`sort_order`, a.`created_at`, t.`id`
FROM `tenants` t
  JOIN `tenants` root ON root.`is_root` = 1
  JOIN `avatar` a ON a.`tenant_id` = root.`id`
WHERE t.`is_root` = 0
  AND EXISTS (
    SELECT 1 FROM `users` u
    WHERE u.`tenant_id` = t.`id` AND u.`profile_photo_path` = a.`path`
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Any community left with an empty picker gets the placeholder.
--
--    The same row `bootstrap.ts` and `tenants-admin.service.create` now write
--    for a community that has just come into existence (Rob, 2026-11-09): one
--    neutral entry, not the 32 bears. The bears are DinnerBears' own and
--    arrive with its import.
--
--    This is what makes "no community loses its picker" true for communities
--    that already exist, since bootstrap only ever runs on a fresh install.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO `avatar` (`path`, `label`, `sort_order`, `created_at`, `tenant_id`)
SELECT '/avatars/cep-default.svg', 'Default', 0, NOW(), t.`id`
FROM `tenants` t
WHERE NOT EXISTS (SELECT 1 FROM `avatar` a WHERE a.`tenant_id` = t.`id`);

-- 6. RESTRICT, matching every other tenant key: deleting a community must fail
--    loudly if the purge ever stops covering this table.
ALTER TABLE `avatar`
  ADD CONSTRAINT `fk_avatar_tenant`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. `merch_config` stops being a singleton.
--
--    Same column, same sentinel, same JOIN-to-root backfill. The surviving row
--    keeps whatever the deployment had configured and it becomes the root
--    tenant's -- which on stage means the seeded Printful link lands on the
--    CommunityEvents root rather than on the imported DinnerBears, since that
--    is a non-root tenant. DinnerBears gets its own store link the way it gets
--    the rest of its data: through the import, which carries this table as of
--    v2-47. A community imported before this migration needs a re-import to
--    pick it up, which is the rehearsed path on stage anyway.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE `merch_config`
  ADD COLUMN `tenant_id` INT UNSIGNED NOT NULL DEFAULT 0;

UPDATE `merch_config` m
  JOIN `tenants` t ON t.`is_root` = 1
  SET m.`tenant_id` = t.`id`
  WHERE m.`tenant_id` = 0;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. One row per community, as a database constraint rather than as everyone
--    agreeing to read id 1.
--
--    Created before step 9 inserts, for the reason in the header. If this
--    index fails, the database held more than one `merch_config` row for the
--    same tenant -- which no code path could produce, so it wants looking at
--    rather than resolving automatically.
-- ───────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX `uq_merch_config_tenant` ON `merch_config` (`tenant_id`);

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Every other community gets an EMPTY row, not a copy.
--
--    The copy is what the bug was. A community that never chose a store does
--    not acquire one here; its admin fills the row in at Admin -> Merch, and
--    `feature_merch` stays off until somebody does.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO `merch_config` (`store_url`, `founding_bear_product_url`, `updated_at`, `tenant_id`)
SELECT NULL, NULL, NOW(), t.`id`
FROM `tenants` t
WHERE NOT EXISTS (SELECT 1 FROM `merch_config` m WHERE m.`tenant_id` = t.`id`);

ALTER TABLE `merch_config`
  ADD CONSTRAINT `fk_merch_config_tenant`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
