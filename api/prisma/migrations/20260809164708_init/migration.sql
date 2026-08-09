-- CreateTable
CREATE TABLE `achievements` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `icon` VARCHAR(255) NOT NULL DEFAULT 'emoji_events',
    `image_path` VARCHAR(500) NULL,
    `progress_type` ENUM('attendance', 'coordinator', 'invite', 'rating', 'founding', 'event', 'city_hopper', 'secret_dinner', 'login', 'new_location_coordinator') NULL,
    `progress_target` INTEGER UNSIGNED NULL,
    `event_id` INTEGER UNSIGNED NULL,
    `points` TINYINT NOT NULL DEFAULT 0,
    `title` VARCHAR(100) NULL,
    `is_secret` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_achievements_key`(`key`),
    INDEX `fk_achievements_event`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcement_comments` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `announcement_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `body` TEXT NOT NULL,
    `edited_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    INDEX `fk_ann_comment_ann`(`announcement_id`),
    INDEX `fk_ann_comment_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `city_id` INTEGER UNSIGNED NULL,
    `status` ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
    `published_at` DATETIME(0) NULL,
    `created_by` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_ann_author`(`created_by`),
    INDEX `fk_ann_city`(`city_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_config` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `config_key` VARCHAR(100) NOT NULL,
    `config_value` TEXT NOT NULL,
    `description` VARCHAR(500) NULL,
    `updated_by` INTEGER UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_config_key`(`config_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(100) NULL,
    `entity_id` INTEGER UNSIGNED NULL,
    `metadata` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_action`(`action`),
    INDEX `idx_created`(`created_at`),
    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `avatar` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `path` VARCHAR(500) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `uq_avatar_path`(`path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cities` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `subdomain` VARCHAR(50) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_subdomain`(`subdomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_flags` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `content_type` ENUM('announcement', 'announcement_comment') NOT NULL,
    `content_id` INTEGER UNSIGNED NOT NULL,
    `reported_by` INTEGER UNSIGNED NOT NULL,
    `reason` VARCHAR(500) NULL,
    `status` ENUM('pending', 'reviewed', 'dismissed') NOT NULL DEFAULT 'pending',
    `reviewed_by` INTEGER UNSIGNED NULL,
    `reviewed_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_flag_reporter`(`reported_by`),
    INDEX `fk_flag_reviewer`(`reviewed_by`),
    UNIQUE INDEX `uq_flag`(`content_type`, `content_id`, `reported_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_reports` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `reporter_id` INTEGER UNSIGNED NOT NULL,
    `content_type` ENUM('event_comment', 'event_comment_reply', 'announcement_comment', 'location_rating') NOT NULL,
    `content_id` INTEGER UNSIGNED NOT NULL,
    `reason` VARCHAR(500) NULL,
    `status` ENUM('pending', 'reviewed', 'dismissed') NOT NULL DEFAULT 'pending',
    `reviewed_by` INTEGER UNSIGNED NULL,
    `reviewed_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `FK_report_reviewer`(`reviewed_by`),
    INDEX `IDX_report_status`(`status`),
    UNIQUE INDEX `UQ_report_per_member`(`reporter_id`, `content_type`, `content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_icons` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `image_path` VARCHAR(500) NOT NULL,
    `created_by` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_custom_icons_created_by`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_provider_config` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `brevo_enabled` BOOLEAN NOT NULL DEFAULT true,
    `resend_overflow_enabled` BOOLEAN NOT NULL DEFAULT false,
    `brevo_daily_limit` INTEGER NOT NULL DEFAULT 300,
    `resend_daily_limit` INTEGER NOT NULL DEFAULT 1000,
    `brevo_sent_today` INTEGER NOT NULL DEFAULT 0,
    `resend_sent_today` INTEGER NOT NULL DEFAULT 0,
    `brevo_api_key` VARCHAR(500) NULL,
    `brevo_from_email` VARCHAR(255) NULL,
    `brevo_from_name` VARCHAR(200) NULL,
    `resend_api_key` VARCHAR(500) NULL,
    `resend_from_email` VARCHAR(255) NULL,
    `resend_from_name` VARCHAR(200) NULL,
    `tmpl_invite` INTEGER UNSIGNED NULL,
    `tmpl_security_alert` INTEGER UNSIGNED NULL,
    `tmpl_event_published` INTEGER UNSIGNED NULL,
    `tmpl_rsvp_confirmation` INTEGER UNSIGNED NULL,
    `tmpl_event_reminder` INTEGER UNSIGNED NULL,
    `tmpl_account_deletion` INTEGER UNSIGNED NULL,
    `tmpl_reengagement_60` INTEGER UNSIGNED NULL,
    `tmpl_reengagement_90` INTEGER UNSIGNED NULL,
    `tmpl_guest_rsvp_confirmation` INTEGER UNSIGNED NULL,
    `tmpl_email_verification` INTEGER UNSIGNED NULL,
    `tmpl_password_reset` INTEGER UNSIGNED NULL,
    `tmpl_provider_disconnected` INTEGER UNSIGNED NULL,
    `tmpl_account_deleted` INTEGER UNSIGNED NULL,
    `last_reset_date` DATE NOT NULL,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_queue` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `to_email` VARCHAR(255) NOT NULL,
    `to_name` VARCHAR(200) NULL,
    `subject` VARCHAR(500) NOT NULL,
    `template_id` VARCHAR(100) NULL,
    `template_params` JSON NULL,
    `html_body` LONGTEXT NULL,
    `text_body` TEXT NULL,
    `priority` TINYINT NOT NULL DEFAULT 5,
    `status` ENUM('pending', 'sent', 'failed', 'cancelled', 'blocked') NOT NULL DEFAULT 'pending',
    `provider` ENUM('brevo', 'gmail') NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(0) NULL,
    `error_message` TEXT NULL,
    `brevo_status` VARCHAR(100) NULL,
    `send_after` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `sent_at` DATETIME(0) NULL,

    INDEX `idx_send_after`(`send_after`),
    INDEX `idx_status_priority`(`status`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_suppressions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `email_hash` VARCHAR(255) NOT NULL,
    `reason` ENUM('unsubscribed', 'bounced', 'complained') NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_email_hash`(`email_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_comment_replies` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `comment_id` INTEGER UNSIGNED NOT NULL,
    `member_id` INTEGER UNSIGNED NOT NULL,
    `body` TEXT NOT NULL,
    `edited_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_ecr_comment`(`comment_id`),
    INDEX `idx_ecr_member`(`member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_comments` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER UNSIGNED NOT NULL,
    `member_id` INTEGER UNSIGNED NOT NULL,
    `body` TEXT NOT NULL,
    `edited_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_ec_event`(`event_id`),
    INDEX `idx_ec_member`(`member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_guest_links` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER UNSIGNED NOT NULL,
    `created_by` INTEGER UNSIGNED NULL,
    `member_rsvp_id` INTEGER UNSIGNED NULL,
    `delivery_type` ENUM('email', 'shareable') NOT NULL DEFAULT 'shareable',
    `source` ENUM('member', 'public') NOT NULL DEFAULT 'member',
    `recipient_name` VARCHAR(200) NULL,
    `recipient_email` VARCHAR(255) NULL,
    `token` VARCHAR(100) NOT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `used_at` DATETIME(0) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `attended` BOOLEAN NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_token`(`token`),
    INDEX `idx_created_by`(`created_by`),
    INDEX `idx_event`(`event_id`),
    INDEX `idx_rsvp`(`member_rsvp_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_rsvps` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `additional_guests` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `guest_names` JSON NULL,
    `bringing_item` VARCHAR(200) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `status` ENUM('going', 'maybe', 'not_going') NOT NULL DEFAULT 'going',
    `attended` BOOLEAN NULL,
    `is_walkin` BOOLEAN NOT NULL DEFAULT false,
    `from_other_city` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_event`(`event_id`),
    INDEX `idx_user`(`user_id`),
    UNIQUE INDEX `uq_event_member`(`event_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `events` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `city_id` INTEGER UNSIGNED NOT NULL,
    `location_id` INTEGER UNSIGNED NULL,
    `location_name` VARCHAR(255) NOT NULL,
    `location_address` VARCHAR(500) NOT NULL,
    `location_lat` DECIMAL(10, 7) NULL,
    `location_lng` DECIMAL(10, 7) NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `additional_info` TEXT NULL,
    `event_date` DATE NOT NULL,
    `event_time` TIME(0) NOT NULL,
    `status` ENUM('draft', 'published', 'cancelled') NOT NULL DEFAULT 'draft',
    `published_at` DATETIME(0) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `cancelled_reason` TEXT NULL,
    `facebook_share_text` TEXT NULL,
    `reservation_assignee_id` INTEGER UNSIGNED NULL,
    `reservation_contact_name` VARCHAR(150) NULL,
    `reservation_contact_email` VARCHAR(255) NULL,
    `reservation_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `reservation_confirmed_by` VARCHAR(255) NULL,
    `reservation_confirmed_at` DATETIME(0) NULL,
    `reservation_confirmed_note` VARCHAR(500) NULL,
    `reservation_seats_email_sent` BOOLEAN NOT NULL DEFAULT false,
    `reservation_confirm_token` VARCHAR(64) NULL,
    `created_by` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_secret` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `uq_events_reservation_token`(`reservation_confirm_token`),
    INDEX `fk_event_created_by`(`created_by`),
    INDEX `fk_event_location`(`location_id`),
    INDEX `fk_events_reservation_assignee`(`reservation_assignee_id`),
    INDEX `idx_city_date`(`city_id`, `event_date`),
    INDEX `idx_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `facebook_deletion_requests` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `facebook_user_id` VARCHAR(255) NOT NULL,
    `confirmation_code` VARCHAR(100) NOT NULL,
    `dinnerbears_user_id` INTEGER UNSIGNED NULL,
    `status` ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
    `requested_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `completed_at` DATETIME(0) NULL,

    UNIQUE INDEX `UQ_fb_deletion_code`(`confirmation_code`),
    INDEX `IDX_fb_deletion_user_id`(`facebook_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `facebook_group_config` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `group_id` VARCHAR(50) NULL,
    `city_id` INTEGER UNSIGNED NULL,
    `group_role` ENUM('primary', 'secondary') NOT NULL DEFAULT 'primary',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_fbgroup_city`(`city_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `title` VARCHAR(200) NULL,
    `category` ENUM('bug', 'feature_request', 'comment') NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('open', 'in_progress', 'resolved', 'shipped', 'closed', 'wont_fix') NOT NULL DEFAULT 'open',
    `admin_note` TEXT NULL,
    `release_note` VARCHAR(500) NULL,
    `is_private` BOOLEAN NOT NULL DEFAULT false,
    `upvote_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `seen_at` DATETIME(0) NULL,
    `resolved_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_feedback_user`(`user_id`),
    INDEX `idx_feedback_category`(`category`),
    INDEX `idx_feedback_created`(`created_at`),
    INDEX `idx_feedback_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback_notes` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `feedback_id` INTEGER UNSIGNED NOT NULL,
    `author_id` INTEGER UNSIGNED NOT NULL,
    `content` TEXT NOT NULL,
    `is_admin_only` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_fnote_author`(`author_id`),
    INDEX `idx_fnote_feedback`(`feedback_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback_upvotes` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `feedback_id` INTEGER UNSIGNED NOT NULL,
    `member_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_fup_member`(`member_id`),
    UNIQUE INDEX `uq_feedback_member`(`feedback_id`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invites` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(100) NOT NULL,
    `type` ENUM('member', 'admin', 'campaign_facebook', 'guest_rsvp', 'shareable_rsvp', 'event_invite') NOT NULL,
    `created_by` INTEGER UNSIGNED NOT NULL,
    `city_id` INTEGER UNSIGNED NULL,
    `event_id` INTEGER UNSIGNED NULL,
    `facebook_group_id` INTEGER UNSIGNED NULL,
    `bound_to_email` VARCHAR(255) NULL,
    `bound_to_name` VARCHAR(200) NULL,
    `redeemed_by` INTEGER UNSIGNED NULL,
    `redeemed_at` DATETIME(0) NULL,
    `guest_rsvp_id` INTEGER UNSIGNED NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `is_revoked` BOOLEAN NOT NULL DEFAULT false,
    `max_uses` INTEGER NULL DEFAULT 1,
    `use_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `invite_flavor` ENUM('member', 'non_validated') NULL,

    UNIQUE INDEX `uq_token`(`token`),
    INDEX `fk_invite_city`(`city_id`),
    INDEX `fk_invite_redeemed_by`(`redeemed_by`),
    INDEX `idx_created_by`(`created_by`),
    INDEX `idx_facebook_group`(`facebook_group_id`),
    INDEX `idx_token`(`token`),
    INDEX `idx_type`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `location_photos` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `location_id` INTEGER UNSIGNED NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_photo_uploader`(`uploaded_by`),
    INDEX `idx_location`(`location_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `location_ratings` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER UNSIGNED NOT NULL,
    `event_id` INTEGER UNSIGNED NOT NULL,
    `location_id` INTEGER UNSIGNED NOT NULL,
    `food` TINYINT UNSIGNED NOT NULL,
    `service` TINYINT UNSIGNED NOT NULL,
    `value_rating` TINYINT UNSIGNED NOT NULL,
    `noise` TINYINT UNSIGNED NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_rating_event`(`event_id`),
    INDEX `fk_rating_location`(`location_id`),
    UNIQUE INDEX `uq_member_event`(`member_id`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `locations` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `phone` VARCHAR(30) NULL,
    `website_url` VARCHAR(500) NULL,
    `description` TEXT NULL,
    `city_id` INTEGER UNSIGNED NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_private` BOOLEAN NOT NULL DEFAULT false,
    `is_residence` BOOLEAN NOT NULL DEFAULT false,
    `imported_from` ENUM('manual', 'facebook_import') NOT NULL DEFAULT 'manual',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `enriched_at` DATETIME(0) NULL,
    `created_by` INTEGER UNSIGNED NULL,
    `updated_by` INTEGER UNSIGNED NULL,
    `moderator_notes` LONGTEXT NULL,
    `contact_name` VARCHAR(100) NULL,
    `contact_phone` VARCHAR(30) NULL,
    `contact_email` VARCHAR(150) NULL,

    INDEX `fk_location_created_by`(`created_by`),
    INDEX `fk_location_updated_by`(`updated_by`),
    INDEX `idx_city`(`city_id`),
    FULLTEXT INDEX `ft_name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_sessions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `jwt_jti` VARCHAR(100) NOT NULL,
    `user_agent` VARCHAR(500) NULL,
    `ip_address` VARCHAR(45) NULL,
    `country` VARCHAR(100) NULL,
    `city` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_active_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_jti`(`jwt_jti`),
    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_achievements` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER UNSIGNED NOT NULL,
    `achievement_id` INTEGER UNSIGNED NOT NULL,
    `earned_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `seen_at` DATETIME(0) NULL,

    INDEX `fk_ma_achievement`(`achievement_id`),
    UNIQUE INDEX `uq_member_achievement`(`member_id`, `achievement_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_points` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `point_type` ENUM('attendance', 'coordinator', 'invite', 'rating', 'city_hopper', 'secret_dinner', 'achievement', 'new_location_coordinator') NOT NULL,
    `reference_id` INTEGER UNSIGNED NOT NULL,
    `points` TINYINT NOT NULL DEFAULT 1,
    `awarded_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_mp_user`(`user_id`),
    UNIQUE INDEX `uq_member_points_user_type_ref`(`user_id`, `point_type`, `reference_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merch_config` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_url` VARCHAR(500) NULL,
    `founding_bear_product_url` VARCHAR(500) NULL,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `email_invite` BOOLEAN NOT NULL DEFAULT true,
    `email_verification` BOOLEAN NOT NULL DEFAULT true,
    `email_password_reset` BOOLEAN NOT NULL DEFAULT true,
    `email_password_changed` BOOLEAN NOT NULL DEFAULT true,
    `email_security_alert` BOOLEAN NOT NULL DEFAULT true,
    `email_event_published` BOOLEAN NOT NULL DEFAULT true,
    `email_rsvp_confirmation` BOOLEAN NOT NULL DEFAULT true,
    `email_event_reminder` BOOLEAN NOT NULL DEFAULT true,
    `email_account_deletion` BOOLEAN NOT NULL DEFAULT true,
    `email_reengagement` BOOLEAN NOT NULL DEFAULT true,
    `push_event_published` BOOLEAN NOT NULL DEFAULT true,
    `push_event_reminder` BOOLEAN NOT NULL DEFAULT true,
    `push_announcement` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `user_id`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NULL,
    `action_url` VARCHAR(500) NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `read_at` DATETIME(0) NULL,

    INDEX `idx_created`(`created_at`),
    INDEX `idx_user_read`(`user_id`, `is_read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_accounts` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `provider` ENUM('google', 'facebook') NOT NULL,
    `provider_id` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `profile_url` VARCHAR(512) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_user`(`user_id`),
    UNIQUE INDEX `uq_provider_account`(`provider`, `provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `endpoint` TEXT NOT NULL,
    `p256dh` VARCHAR(512) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_endpoint`(`endpoint`(500)),
    INDEX `fk_push_sub_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `release_feedback` (
    `release_id` INTEGER UNSIGNED NOT NULL,
    `feedback_id` INTEGER UNSIGNED NOT NULL,

    INDEX `fk_rf_feedback`(`feedback_id`),
    PRIMARY KEY (`release_id`, `feedback_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `releases` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `version` VARCHAR(20) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `published_at` DATETIME(0) NULL,
    `created_by` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_release_version`(`version`),
    INDEX `fk_release_author`(`created_by`),
    INDEX `idx_release_published`(`published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(200) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `email_status` ENUM('pending', 'active', 'unsubscribed', 'bounced', 'complained') NOT NULL DEFAULT 'pending',
    `email_verified_at` DATETIME(0) NULL,
    `password_hash` VARCHAR(255) NULL,
    `email_verification_token` VARCHAR(255) NULL,
    `email_verification_expires_at` DATETIME(0) NULL,
    `password_reset_token` VARCHAR(255) NULL,
    `password_reset_expires_at` DATETIME(0) NULL,
    `city_id` INTEGER UNSIGNED NOT NULL,
    `role` ENUM('non_validated', 'member', 'moderator', 'admin', 'automation') NOT NULL DEFAULT 'member',
    `has_membership` BOOLEAN NOT NULL DEFAULT false,
    `membership_expires_at` DATETIME(0) NULL,
    `profile_photo_path` VARCHAR(500) NULL,
    `status` ENUM('active', 'suspended', 'deleted') NOT NULL DEFAULT 'active',
    `invited_by` INTEGER UNSIGNED NULL,
    `invite_id` INTEGER UNSIGNED NULL,
    `invite_source` ENUM('direct', 'facebook_group', 'google_oauth', 'non_validated_link') NULL,
    `invite_source_name` VARCHAR(255) NULL,
    `last_login_at` DATETIME(0) NULL,
    `login_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `failed_login_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `login_locked_until` DATETIME(0) NULL,
    `last_failed_login_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,
    `hard_delete_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `calendar_token` VARCHAR(36) NULL,
    `calendar_city_filter` ENUM('all', 'city') NOT NULL DEFAULT 'all',
    `calendar_rsvp_only` BOOLEAN NOT NULL DEFAULT false,
    `calendar_auto_invite` ENUM('none', 'city', 'all') NOT NULL DEFAULT 'none',
    `selected_title` VARCHAR(100) NULL,
    `qualifying_login_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `last_qualifying_login_at` DATETIME(0) NULL,
    `last_seen_release_id` INTEGER UNSIGNED NULL,
    `last_seen_announcement_id` INTEGER UNSIGNED NULL,

    UNIQUE INDEX `uq_email`(`email`),
    UNIQUE INDEX `calendar_token`(`calendar_token`),
    INDEX `fk_users_city`(`city_id`),
    INDEX `fk_users_invite`(`invite_id`),
    INDEX `fk_users_last_seen_announcement`(`last_seen_announcement_id`),
    INDEX `fk_users_last_seen_release`(`last_seen_release_id`),
    INDEX `idx_email_status`(`email_status`),
    INDEX `idx_invited_by`(`invited_by`),
    INDEX `idx_last_login`(`last_login_at`),
    INDEX `idx_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `achievements` ADD CONSTRAINT `fk_achievements_event` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `announcement_comments` ADD CONSTRAINT `fk_ann_comment_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `announcement_comments` ADD CONSTRAINT `fk_ann_comment_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `fk_ann_author` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `fk_ann_city` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `content_flags` ADD CONSTRAINT `fk_flag_reporter` FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `content_flags` ADD CONSTRAINT `fk_flag_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `content_reports` ADD CONSTRAINT `FK_report_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `content_reports` ADD CONSTRAINT `FK_report_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `custom_icons` ADD CONSTRAINT `fk_custom_icons_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_comment_replies` ADD CONSTRAINT `fk_ecr_comment` FOREIGN KEY (`comment_id`) REFERENCES `event_comments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_comment_replies` ADD CONSTRAINT `fk_ecr_member` FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_comments` ADD CONSTRAINT `fk_ec_event` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_comments` ADD CONSTRAINT `fk_ec_member` FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_guest_links` ADD CONSTRAINT `fk_guestlink_event` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_guest_links` ADD CONSTRAINT `fk_guestlink_rsvp` FOREIGN KEY (`member_rsvp_id`) REFERENCES `event_rsvps`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_guest_links` ADD CONSTRAINT `fk_guestlink_user` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_rsvps` ADD CONSTRAINT `fk_rsvp_event` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_rsvps` ADD CONSTRAINT `fk_rsvp_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `fk_event_city` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `fk_event_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `fk_event_location` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `fk_events_reservation_assignee` FOREIGN KEY (`reservation_assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `facebook_group_config` ADD CONSTRAINT `fk_fbgroup_city` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `feedback` ADD CONSTRAINT `fk_feedback_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `feedback_notes` ADD CONSTRAINT `fk_fnote_author` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `feedback_notes` ADD CONSTRAINT `fk_fnote_feedback` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `feedback_upvotes` ADD CONSTRAINT `fk_fup_feedback` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `feedback_upvotes` ADD CONSTRAINT `fk_fup_member` FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `fk_invite_city` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `fk_invite_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `fk_invite_fbgroup` FOREIGN KEY (`facebook_group_id`) REFERENCES `facebook_group_config`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `fk_invite_redeemed_by` FOREIGN KEY (`redeemed_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `location_photos` ADD CONSTRAINT `fk_photo_location` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `location_photos` ADD CONSTRAINT `fk_photo_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `location_ratings` ADD CONSTRAINT `fk_rating_event` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `location_ratings` ADD CONSTRAINT `fk_rating_location` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `location_ratings` ADD CONSTRAINT `fk_rating_member` FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `fk_location_city` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `fk_location_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `fk_location_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `login_sessions` ADD CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `member_achievements` ADD CONSTRAINT `fk_ma_achievement` FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `member_achievements` ADD CONSTRAINT `fk_ma_member` FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `member_points` ADD CONSTRAINT `fk_mp_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `fk_notif_pref_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `oauth_accounts` ADD CONSTRAINT `fk_oauth_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `fk_push_sub_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `release_feedback` ADD CONSTRAINT `fk_rf_feedback` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `release_feedback` ADD CONSTRAINT `fk_rf_release` FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `releases` ADD CONSTRAINT `fk_release_author` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `fk_users_city` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `fk_users_invite` FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `fk_users_invited_by` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `fk_users_last_seen_announcement` FOREIGN KEY (`last_seen_announcement_id`) REFERENCES `announcements`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `fk_users_last_seen_release` FOREIGN KEY (`last_seen_release_id`) REFERENCES `releases`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
