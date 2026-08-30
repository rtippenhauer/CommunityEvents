-- v2-9: email provider config becomes per-community.
--
-- It was a singleton looked up by `id: 1` -- one Brevo key, one From identity
-- and one daily counter for every community on the deployment. That was never a
-- decision so much as an artifact: `seed.ts` writes the row, and seed runs
-- before `bootstrap.ts` creates any tenant, so the column could not have existed
-- without moving the write. This migration adds it; the write moves in the same
-- change, exactly as v2-6 had to move the `app_config` defaults and the
-- automation account for the same reason.
--
-- The DEFAULT 0 sentinel and ON DELETE RESTRICT are v2-5's convention and are
-- explained at length in 20260814025642_add_tenant_id_columns: 0 keeps
-- `tenantId` optional in Prisma's create inputs so the extension can supply it,
-- and the foreign key rejects the sentinel so a create that escapes the
-- extension dies at the database rather than writing a row belonging to nobody.
--
-- On an existing deployment the single configured row is handed to the root
-- tenant, which is the community it has effectively been serving. Every other
-- community starts with no row and therefore no key, falling back to the env
-- vars exactly as it did before this change.

ALTER TABLE `email_provider_config` ADD COLUMN `webhook_secret` VARCHAR(500) NULL;
ALTER TABLE `email_provider_config` ADD COLUMN `webhook_id` VARCHAR(64) NULL;

ALTER TABLE `email_provider_config` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `email_provider_config` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `email_provider_config` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;

-- One row per community, so the extension's `findFirst` cannot pick between two.
CREATE UNIQUE INDEX `uq_email_provider_config_tenant` ON `email_provider_config`(`tenant_id`);
ALTER TABLE `email_provider_config` ADD CONSTRAINT `fk_email_provider_config_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
