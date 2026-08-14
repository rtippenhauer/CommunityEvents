-- Tenant scoping columns (v2-5, REQ-TENANT-01.3).
--
-- Adds `tenant_id` to every model listed in TENANT_SCOPED_MODELS
-- (api/src/common/tenant/tenant-scoped-models.ts). The two lists must stay in
-- step; tenant-scoped-models.spec.ts checks them against each other.
--
-- Prisma generated this as a bare `ADD COLUMN ... NOT NULL`, which only works
-- on an empty table. That is true of a fresh install but not of stage, which is
-- already carrying data, so each table is instead widened in three steps:
-- add the column nullable, backfill it, then tighten it to NOT NULL.
--
-- The backfill repeats the root-tenant subquery per statement rather than
-- reading it once into a session variable. A session variable would be one
-- lookup instead of 27, but it only survives if every statement in this file
-- runs on the same connection -- and if it ever did not, the backfill would
-- silently write NULL and the NOT NULL step would fail somewhere far from the
-- cause. The subquery cannot come apart that way.
--
-- On a fresh install this migration runs before bootstrap.ts has created any
-- tenant at all: every table is empty, so each UPDATE matches nothing, the
-- subquery's NULL is never written, and NOT NULL applies cleanly. On a database
-- that has rows but no root tenant the NOT NULL step fails loudly, which is the
-- correct outcome -- there is no way to guess which tenant existing rows belong
-- to.
--
-- ON DELETE RESTRICT, not CASCADE: deleting a tenant should not be able to
-- silently destroy a community's entire history as a side effect. A deliberate
-- tenant deletion has to clear its data first.
--
-- DEFAULT 0 is a sentinel, not a usable value. It exists so Prisma's generated
-- create inputs treat `tenantId` as optional -- the extension supplies it, and
-- without the default every one of the ~100 create() call sites would have to
-- pass a tenant id by hand, which is exactly the manual scoping REQ-TENANT-01.3
-- rules out. Nothing can actually persist a 0: `tenants.id` is AUTO_INCREMENT
-- and so never 0, meaning the foreign key below rejects the sentinel. A create
-- that somehow escapes the extension therefore fails at the database rather than
-- writing a row belonging to nobody.

-- announcement_comments
ALTER TABLE `announcement_comments` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `announcement_comments` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `announcement_comments` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_announcement_comments_tenant` ON `announcement_comments`(`tenant_id`);
ALTER TABLE `announcement_comments` ADD CONSTRAINT `fk_announcement_comments_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- announcements
ALTER TABLE `announcements` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `announcements` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `announcements` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_announcements_tenant` ON `announcements`(`tenant_id`);
ALTER TABLE `announcements` ADD CONSTRAINT `fk_announcements_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- audit_log
ALTER TABLE `audit_log` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `audit_log` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `audit_log` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_audit_log_tenant` ON `audit_log`(`tenant_id`);
ALTER TABLE `audit_log` ADD CONSTRAINT `fk_audit_log_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- content_flags
ALTER TABLE `content_flags` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `content_flags` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `content_flags` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_content_flags_tenant` ON `content_flags`(`tenant_id`);
ALTER TABLE `content_flags` ADD CONSTRAINT `fk_content_flags_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- content_reports
ALTER TABLE `content_reports` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `content_reports` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `content_reports` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_content_reports_tenant` ON `content_reports`(`tenant_id`);
ALTER TABLE `content_reports` ADD CONSTRAINT `fk_content_reports_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- custom_icons
ALTER TABLE `custom_icons` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `custom_icons` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `custom_icons` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_custom_icons_tenant` ON `custom_icons`(`tenant_id`);
ALTER TABLE `custom_icons` ADD CONSTRAINT `fk_custom_icons_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- email_queue
ALTER TABLE `email_queue` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `email_queue` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `email_queue` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_email_queue_tenant` ON `email_queue`(`tenant_id`);
ALTER TABLE `email_queue` ADD CONSTRAINT `fk_email_queue_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- event_comment_replies
ALTER TABLE `event_comment_replies` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `event_comment_replies` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `event_comment_replies` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_event_comment_replies_tenant` ON `event_comment_replies`(`tenant_id`);
ALTER TABLE `event_comment_replies` ADD CONSTRAINT `fk_event_comment_replies_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- event_comments
ALTER TABLE `event_comments` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `event_comments` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `event_comments` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_event_comments_tenant` ON `event_comments`(`tenant_id`);
ALTER TABLE `event_comments` ADD CONSTRAINT `fk_event_comments_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- event_guest_links
ALTER TABLE `event_guest_links` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `event_guest_links` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `event_guest_links` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_event_guest_links_tenant` ON `event_guest_links`(`tenant_id`);
ALTER TABLE `event_guest_links` ADD CONSTRAINT `fk_event_guest_links_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- event_rsvps
ALTER TABLE `event_rsvps` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `event_rsvps` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `event_rsvps` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_event_rsvps_tenant` ON `event_rsvps`(`tenant_id`);
ALTER TABLE `event_rsvps` ADD CONSTRAINT `fk_event_rsvps_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- events
ALTER TABLE `events` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `events` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `events` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_events_tenant` ON `events`(`tenant_id`);
ALTER TABLE `events` ADD CONSTRAINT `fk_events_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- facebook_group_config
ALTER TABLE `facebook_group_config` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `facebook_group_config` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `facebook_group_config` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_facebook_group_config_tenant` ON `facebook_group_config`(`tenant_id`);
ALTER TABLE `facebook_group_config` ADD CONSTRAINT `fk_facebook_group_config_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- feedback
ALTER TABLE `feedback` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `feedback` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `feedback` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_feedback_tenant` ON `feedback`(`tenant_id`);
ALTER TABLE `feedback` ADD CONSTRAINT `fk_feedback_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- feedback_notes
ALTER TABLE `feedback_notes` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `feedback_notes` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `feedback_notes` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_feedback_notes_tenant` ON `feedback_notes`(`tenant_id`);
ALTER TABLE `feedback_notes` ADD CONSTRAINT `fk_feedback_notes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- feedback_upvotes
ALTER TABLE `feedback_upvotes` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `feedback_upvotes` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `feedback_upvotes` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_feedback_upvotes_tenant` ON `feedback_upvotes`(`tenant_id`);
ALTER TABLE `feedback_upvotes` ADD CONSTRAINT `fk_feedback_upvotes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- invites
ALTER TABLE `invites` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `invites` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `invites` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_invites_tenant` ON `invites`(`tenant_id`);
ALTER TABLE `invites` ADD CONSTRAINT `fk_invites_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- location_photos
ALTER TABLE `location_photos` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `location_photos` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `location_photos` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_location_photos_tenant` ON `location_photos`(`tenant_id`);
ALTER TABLE `location_photos` ADD CONSTRAINT `fk_location_photos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- location_ratings
ALTER TABLE `location_ratings` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `location_ratings` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `location_ratings` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_location_ratings_tenant` ON `location_ratings`(`tenant_id`);
ALTER TABLE `location_ratings` ADD CONSTRAINT `fk_location_ratings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- locations
ALTER TABLE `locations` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `locations` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `locations` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_locations_tenant` ON `locations`(`tenant_id`);
ALTER TABLE `locations` ADD CONSTRAINT `fk_locations_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- login_sessions
ALTER TABLE `login_sessions` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `login_sessions` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `login_sessions` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_login_sessions_tenant` ON `login_sessions`(`tenant_id`);
ALTER TABLE `login_sessions` ADD CONSTRAINT `fk_login_sessions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- member_achievements
ALTER TABLE `member_achievements` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `member_achievements` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `member_achievements` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_member_achievements_tenant` ON `member_achievements`(`tenant_id`);
ALTER TABLE `member_achievements` ADD CONSTRAINT `fk_member_achievements_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- member_points
ALTER TABLE `member_points` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `member_points` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `member_points` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_member_points_tenant` ON `member_points`(`tenant_id`);
ALTER TABLE `member_points` ADD CONSTRAINT `fk_member_points_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- notification_preferences
ALTER TABLE `notification_preferences` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `notification_preferences` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `notification_preferences` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_notification_preferences_tenant` ON `notification_preferences`(`tenant_id`);
ALTER TABLE `notification_preferences` ADD CONSTRAINT `fk_notification_preferences_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- notifications
ALTER TABLE `notifications` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `notifications` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `notifications` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_notifications_tenant` ON `notifications`(`tenant_id`);
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- oauth_accounts
ALTER TABLE `oauth_accounts` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `oauth_accounts` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `oauth_accounts` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_oauth_accounts_tenant` ON `oauth_accounts`(`tenant_id`);
ALTER TABLE `oauth_accounts` ADD CONSTRAINT `fk_oauth_accounts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- push_subscriptions
ALTER TABLE `push_subscriptions` ADD COLUMN `tenant_id` INTEGER UNSIGNED NULL;
UPDATE `push_subscriptions` SET `tenant_id` = (SELECT `id` FROM `tenants` WHERE `root_marker` = 1 LIMIT 1) WHERE `tenant_id` IS NULL;
ALTER TABLE `push_subscriptions` MODIFY COLUMN `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX `idx_push_subscriptions_tenant` ON `push_subscriptions`(`tenant_id`);
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `fk_push_subscriptions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Widen two unique keys with tenant_id (see schema.prisma for why)
CREATE UNIQUE INDEX `uq_member_achievement_v2` ON `member_achievements`(`member_id`, `achievement_id`, `tenant_id`);
DROP INDEX `uq_member_achievement` ON `member_achievements`;
ALTER TABLE `member_achievements` RENAME INDEX `uq_member_achievement_v2` TO `uq_member_achievement`;

CREATE UNIQUE INDEX `uq_member_points_user_type_ref_v2` ON `member_points`(`user_id`, `point_type`, `reference_id`, `tenant_id`);
DROP INDEX `uq_member_points_user_type_ref` ON `member_points`;
ALTER TABLE `member_points` RENAME INDEX `uq_member_points_user_type_ref_v2` TO `uq_member_points_user_type_ref`;
