-- User and runtime-config tenant scoping (v2-6, REQ-TENANT-01.4 / 01.5).
--
-- Moves the last two models that hold per-community data out of the global set:
-- `users` (every account) and `app_config` (branding, feature flags, terminology).
-- Both must be added to TENANT_SCOPED_MODELS in the same change; the exhaustive
-- type over Prisma.ModelName means the build fails otherwise.
--
-- Written by hand rather than generated. `prisma migrate dev` refuses to run
-- non-interactively once a migration adds a unique constraint, and its output
-- would have been a bare `ADD COLUMN ... NOT NULL` -- correct on a fresh install,
-- but not on stage, which already carries rows. Each table is therefore widened
-- in the three steps v2-5 established: add the column nullable, backfill it,
-- then tighten it to NOT NULL DEFAULT 0.
--
-- The DEFAULT 0 sentinel and ON DELETE RESTRICT choices are v2-5's and are
-- explained at length in 20260814025642_add_tenant_id_columns. In short: 0 keeps
-- `tenantId` optional in Prisma's generated create inputs so the extension can
-- supply it, and the foreign key rejects the sentinel so a create that escapes
-- the extension dies at the database instead of writing a row belonging to
-- nobody.
--
-- Ordering note for a fresh install: this runs before bootstrap.ts exists any
-- tenant, but also before seed.ts writes anything, so every table here is empty,
-- each UPDATE matches nothing, and NOT NULL applies cleanly. That emptiness is
-- also why the automation account and the app_config defaults had to move out of
-- seed.ts and into bootstrap.ts in this same change -- seed runs before any
-- tenant exists, so a row it wrote now would fail the foreign key below.

-- ── users ───────────────────────────────────────────────────────────────────
ALTER TABLE `users` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `users` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `users` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;

-- Email becomes unique *within* a tenant. The index name is reused so nothing
-- downstream has to learn a new one, which means the old one has to go first.
-- On a database with real data this is the statement that can fail, and failing
-- is correct: two accounts sharing an address inside one community is precisely
-- what must not exist.
DROP INDEX `uq_email` ON `users`;
CREATE UNIQUE INDEX `uq_email` ON `users`(`tenant_id`, `email`);

CREATE INDEX `idx_users_tenant` ON `users`(`tenant_id`);
ALTER TABLE `users` ADD CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ── app_config ──────────────────────────────────────────────────────────────
ALTER TABLE `app_config` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `app_config` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `app_config` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;

DROP INDEX `uq_config_key` ON `app_config`;
CREATE UNIQUE INDEX `uq_config_key` ON `app_config`(`tenant_id`, `config_key`);

CREATE INDEX `idx_app_config_tenant` ON `app_config`(`tenant_id`);
ALTER TABLE `app_config` ADD CONSTRAINT `fk_app_config_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ── oauth_accounts ──────────────────────────────────────────────────────────
-- tenant_id already exists (v2-5); only the key changes. Globally unique meant
-- the first community to claim a provider account owned it everywhere -- the
-- same person being told their own Google login was already taken when they
-- tried to join a second community.
DROP INDEX `uq_provider_account` ON `oauth_accounts`;
CREATE UNIQUE INDEX `uq_provider_account` ON `oauth_accounts`(`tenant_id`, `provider`, `provider_id`);
