-- v2-14: ephemeral per-visitor demo communities.
--
-- One demo tenant per visitor, deleted outright when `demo_expires_at` passes.
-- Per-visitor rather than one shared demo because an admin can see every user's
-- email address, their linked OAuth addresses and the address each invite was
-- bound to -- on a shared demo where signing up granted admin, that is a
-- searchable directory of strangers' addresses handed to the next stranger.
--
-- `is_demo` therefore grants nothing. It marks a community as ephemeral, blocks
-- it from sending mail, and is checked by the expiry sweep. The CHECK constraint
-- keeps it off the root tenant, which is the deployment's own community: Prisma
-- cannot express a CHECK in schema.prisma, so it is written here, which also
-- means replaying the history reproduces it and drift detection stays quiet.
-- MySQL has enforced CHECK constraints since 8.0.16 and stage runs 9.7.
ALTER TABLE `tenants`
  ADD COLUMN `is_demo` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `demo_expires_at` DATETIME(0) NULL;

ALTER TABLE `tenants`
  ADD CONSTRAINT `chk_tenant_demo_not_root` CHECK (NOT (`is_root` = 1 AND `is_demo` = 1));

-- The pending half of "ask for a demo, then confirm by email". Global: the row
-- exists precisely while the tenant it will create does not, so there is nothing
-- to scope it to. It outlives confirmation because `ip_address` is what makes
-- the per-IP cap on live demos answerable, and is deleted with its demo.
CREATE TABLE `demo_requests` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`         VARCHAR(255) NOT NULL,
  `full_name`     VARCHAR(200) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `token`         VARCHAR(64)  NOT NULL,
  `ip_address`    VARCHAR(64)  NULL,
  `created_tenant_id` INT UNSIGNED NULL,
  `confirmed_at`  DATETIME(0)  NULL,
  `expires_at`    DATETIME(0)  NOT NULL,
  `created_at`    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_demo_request_token`(`token`),
  UNIQUE INDEX `uq_demo_request_tenant`(`created_tenant_id`),
  INDEX `idx_demo_request_expires`(`expires_at`),
  INDEX `idx_demo_request_ip`(`ip_address`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CASCADE so deleting the demo takes the address and IP with it.
ALTER TABLE `demo_requests` ADD CONSTRAINT `fk_demo_request_tenant`
  FOREIGN KEY (`created_tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
