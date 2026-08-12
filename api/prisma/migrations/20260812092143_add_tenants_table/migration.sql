-- CreateTable
CREATE TABLE `tenants` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(50) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `is_root` BOOLEAN NOT NULL DEFAULT false,
    `root_marker` BOOLEAN NULL,
    `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    `db_mode` ENUM('shared', 'dedicated') NOT NULL DEFAULT 'shared',
    `google_client_id` VARCHAR(255) NULL,
    `google_client_secret` TEXT NULL,
    `facebook_app_id` VARCHAR(255) NULL,
    `facebook_app_secret` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_tenant_slug`(`slug`),
    UNIQUE INDEX `uq_tenant_domain`(`domain`),
    UNIQUE INDEX `uq_tenant_single_root`(`root_marker`),
    INDEX `idx_tenant_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
