-- Encrypted secrets at rest (v2-7).
--
-- Adds the one new table the item needs. The two columns it was really about --
-- email_provider_config.brevo_api_key and resend_api_key -- need no DDL at all:
-- they are already VARCHAR(500), which comfortably holds an envelope, and the
-- change to them is that the Prisma extension now writes ciphertext there.
-- Existing rows keep their plaintext until `npm run secrets:rewrap` rewrites
-- them, which is deliberate; see secret-cipher.ts for why reads tolerate a bare
-- value and why that tolerance is bounded.
--
-- ── Why a table and not app_config rows ──────────────────────────────────────
--
-- app_config is the obvious home for per-community settings and is the wrong
-- home for these. Its rows are served to unauthenticated visitors: the branding
-- payload reads that table, and so does the public /config/:key endpoint. Both
-- are allowlisted, and the allowlist is the only thing between "somebody adds a
-- config key" and "a credential in a public response" -- an allowlist being,
-- structurally, a thing people add to. Separate tables mean no future query can
-- confuse a theme colour with an API key.
--
-- ── Shape notes ──────────────────────────────────────────────────────────────
--
-- tenant_id carries the same DEFAULT 0 sentinel and RESTRICT foreign key as
-- every other scoped table; 20260814025642_add_tenant_id_columns explains both
-- at length. In short, the default keeps `tenantId` optional in Prisma's create
-- input so the scoping extension can supply it, and the foreign key rejects the
-- sentinel so a create that escapes the extension dies at the database rather
-- than writing a row belonging to nobody. RESTRICT (not CASCADE) is what makes
-- tenants.delete() fail loudly if this table is ever left out of the purge list
-- in tenants-admin.service.ts -- it is driven by TENANT_SCOPED_MODELS, so
-- adding the model to that list is what keeps deletion complete.
--
-- No foreign key on updated_by, matching app_config: the row records who last
-- touched a setting, and that record should outlive the account.
CREATE TABLE `tenant_secrets` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `secret_key` VARCHAR(100) NOT NULL,
    `secret_value` TEXT NOT NULL,
    `updated_by` INTEGER UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    UNIQUE INDEX `uq_tenant_secret_key`(`tenant_id`, `secret_key`),
    INDEX `idx_tenant_secrets_tenant`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_secrets`
    ADD CONSTRAINT `fk_tenant_secrets_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE RESTRICT ON UPDATE NO ACTION;
