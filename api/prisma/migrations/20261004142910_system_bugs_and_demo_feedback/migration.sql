-- A channel from a community to the operator (v2-32, Rob 2026-10-03/04).
--
-- Two tables, deliberately not one, because they have opposite audiences:
-- `system_bugs` is read by every non-demo community's admins, `demo_feedback`
-- by nobody but the demo's own admin and the operator. A single table with a
-- visibility column would make the wrong default -- visible -- the cheap one.
--
-- Both are GLOBAL (no `tenant_id`): each has to outlive the community it came
-- from. `feedback` stays tenant-scoped and is untouched here. A member wrote
-- that having consented to their own community's admins reading it; these rows
-- were written in order to cross a boundary, which is a different consent.
--
-- **Every foreign key is ON DELETE SET NULL, and that is load-bearing.** These
-- are global tables pointing at the scoped `users` and `tenants`. A restrictive
-- key would block `purgeTenantRows`, which walks only the scoped model list and
-- would therefore never clear it -- so deleting a community would fail on a bug
-- one of its admins filed years earlier, and purging a demo would fail on the
-- feedback its visitor just left. `tenant-scoped-models.spec` does not catch
-- this: it checks scoped->scoped keys only.
--
-- `demo_label` is written at submission time and is the only thing that still
-- says which demo a row came from, since `submitted_by_tenant_id` goes NULL
-- when the demo is purged -- a certainty for a demo rather than a risk.

-- CreateTable
CREATE TABLE `demo_feedback` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `body` TEXT NOT NULL,
    `rating` TINYINT UNSIGNED NULL,
    `demo_label` VARCHAR(120) NOT NULL,
    `submitted_by_user_id` INTEGER UNSIGNED NULL,
    `submitted_by_tenant_id` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_demo_feedback_user`(`submitted_by_user_id`),
    INDEX `fk_demo_feedback_tenant`(`submitted_by_tenant_id`),
    INDEX `idx_demo_feedback_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_bugs` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('open', 'in_progress', 'resolved', 'shipped', 'closed', 'wont_fix') NOT NULL DEFAULT 'open',
    `admin_note` TEXT NULL,
    `reported_by_user_id` INTEGER UNSIGNED NULL,
    `reported_by_tenant_id` INTEGER UNSIGNED NULL,
    `resolved_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_system_bug_reporter`(`reported_by_user_id`),
    INDEX `fk_system_bug_tenant`(`reported_by_tenant_id`),
    INDEX `idx_system_bug_status`(`status`),
    INDEX `idx_system_bug_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `demo_feedback` ADD CONSTRAINT `fk_demo_feedback_user` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `demo_feedback` ADD CONSTRAINT `fk_demo_feedback_tenant` FOREIGN KEY (`submitted_by_tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `system_bugs` ADD CONSTRAINT `fk_system_bug_reporter` FOREIGN KEY (`reported_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `system_bugs` ADD CONSTRAINT `fk_system_bug_tenant` FOREIGN KEY (`reported_by_tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
