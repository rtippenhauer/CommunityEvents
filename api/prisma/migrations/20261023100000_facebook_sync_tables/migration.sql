-- The Facebook mirror's three tables, plus the RSVP columns it needs (v2-29).
--
-- Ported from v1's `AddFacebookAttendees` and `AddFacebookGuestsToRsvps`, with
-- the tenant changes below. v1's one-time data fix is deliberately not carried
-- across: it repaired rows written by a first Phase 39 build that only ever
-- reached v1's stage, and no database here has ever held them.
--
-- ## Every unique key gains the tenant
--
-- `(tenant_id, facebook_event_id)` and `(tenant_id, facebook_user_id)` /
-- `(tenant_id, profile_url)`, so **two communities may share a Facebook event
-- or a Facebook person**. In v1 these were globally unique, which is correct for
-- one community and wrong here: Gem City Bears could be mirrored by two
-- communities, and one person can be on both their Going lists. A global unique
-- would make the second community's sync fail on the first's rows.
--
-- This is the same defect `v2-5` fixed in `member_achievements` and
-- `member_points`, whose keys were built on globally-unique ids so one
-- community's award blocked another's.
--
-- `facebook_event_attendees` keeps v1's `(event_id, facebook_account_id)`
-- **without** a tenant column in the key, and that is not an oversight: both
-- ids are AUTO_INCREMENT primary keys of tenant-owned rows, so the pair can
-- only ever name one community's data. The keys above are different because
-- `facebook_event_id` and `facebook_user_id` are **Facebook's** identifiers,
-- which two communities can legitimately both hold.
--
-- ## Why the RSVP columns are separate from `guest_names`
--
-- `facebook_guest_names` sits beside the website's `guest_names` and is never
-- merged into it (rule 10). The two have opposite lifetimes: Facebook +1s are
-- replaced on every sync and may go *down* as comments change, while website
-- guests are the member's own entry and must never be touched by an
-- integration. Merging them would make a sync able to delete what a member
-- typed, with no way to tell which was which afterwards.
--
-- `source` is what makes removal safe (rule 8): the sync may only delete an
-- RSVP it created. Without the column every imported RSVP looks website-made,
-- so either the sync removes RSVPs members made themselves, or it can never
-- remove anything.

ALTER TABLE `event_rsvps`
    ADD COLUMN `source` ENUM('member', 'admin', 'facebook_sync') NOT NULL DEFAULT 'member' AFTER `bringing_item`,
    -- JSON rather than a child table: this is a replaced-wholesale list of
    -- names with no identity of its own, and nothing ever queries one +1.
    -- NULL and `[]` both mean "no named +1s"; NULL is what an untouched row
    -- holds, so the two are not collapsed.
    ADD COLUMN `facebook_guest_names` JSON NULL AFTER `source`,
    -- Total +1s including unnamed ones, so `count - names.length` is how many
    -- had no name in the comment. TINYINT because the API caps it at 20.
    ADD COLUMN `facebook_guest_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `facebook_guest_names`;

CREATE TABLE `event_facebook_links` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER UNSIGNED NOT NULL,
    -- Facebook's own id, digits from `facebook.com/events/<id>`. A string
    -- because it exceeds 32 bits and is an identifier rather than a number.
    `facebook_event_id` VARCHAR(32) NOT NULL,
    -- Free text, never a foreign key. `v2-24` drops `facebook_group_config`,
    -- and a group is a label on the link rather than an entity we model.
    `facebook_group` VARCHAR(200) NULL,
    -- When the list we last applied was READ from Facebook, not when we applied
    -- it. That is what makes rule 12's replay guard work: a slow run whose
    -- extraction predates one already applied must be skipped, and a
    -- received-at timestamp cannot tell the difference.
    `last_extracted_at` DATETIME(0) NULL,
    `last_synced_at` DATETIME(0) NULL,
    `last_going_count` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    -- One Facebook event mirrors one dinner **per community** (rule 2); a
    -- second attempt is the 409 the contract promises.
    UNIQUE INDEX `uq_event_facebook_links_fb_event`(`tenant_id`, `facebook_event_id`),
    INDEX `idx_event_facebook_links_event`(`event_id`),
    INDEX `idx_event_facebook_links_tenant`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `facebook_accounts` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    -- The vanity URL, refreshed every sync (rule 4). Nullable because the
    -- numeric id is the real key and a profile may be seen without one.
    `profile_url` VARCHAR(255) NULL,
    -- The permanent key. A changed vanity URL just updates the row.
    `facebook_user_id` VARCHAR(32) NULL,
    `display_name` VARCHAR(200) NOT NULL,
    -- `not_member` keeps somebody counted in the headcount while taking them
    -- out of the admin's review queue -- they are a real attendee who simply
    -- has no account here, which is different from one nobody has looked at.
    `status` ENUM('unmatched', 'linked', 'not_member') NOT NULL DEFAULT 'unmatched',
    `user_id` INTEGER UNSIGNED NULL,
    `linked_at` DATETIME(0) NULL,
    `linked_by` INTEGER UNSIGNED NULL,
    `last_seen_at` DATETIME(0) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    -- Both scoped: one Facebook person may appear in several communities, as a
    -- separate row each time, because the link to a member is a judgement one
    -- community's admin made and must not bind another's.
    UNIQUE INDEX `uq_facebook_accounts_fb_user_id`(`tenant_id`, `facebook_user_id`),
    UNIQUE INDEX `uq_facebook_accounts_profile_url`(`tenant_id`, `profile_url`),
    INDEX `idx_facebook_accounts_user`(`user_id`),
    INDEX `idx_facebook_accounts_tenant`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `facebook_event_attendees` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER UNSIGNED NOT NULL,
    `facebook_account_id` INTEGER UNSIGNED NOT NULL,
    -- Keyed by Facebook event id: which of this dinner's lists this person is
    -- on, and their +1s as read from each. Rule 3 turns on it -- somebody stops
    -- being Going only when NO list has them -- so a per-list record is the
    -- whole mechanism rather than a detail. Facebook's ids are not remapped.
    `sources` JSON NOT NULL,
    -- Tri-state: NULL is "not marked yet", which is different from marked
    -- no-show. A boolean would make an unreviewed dinner look like a room full
    -- of no-shows.
    `attended` BOOLEAN NULL DEFAULT NULL,
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    -- No tenant in this key, deliberately -- see the header. Both halves are
    -- AUTO_INCREMENT ids of tenant-owned rows, so the pair already names one
    -- community.
    UNIQUE INDEX `uq_fb_attendee_event_account`(`event_id`, `facebook_account_id`),
    INDEX `idx_fb_attendee_account`(`facebook_account_id`),
    INDEX `idx_fb_attendee_tenant`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `event_facebook_links`
  ADD CONSTRAINT `fk_event_facebook_links_event` FOREIGN KEY (`event_id`)
    REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT `fk_event_facebook_links_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `facebook_accounts`
  -- SET NULL, not CASCADE: the Facebook person outlives the member they were
  -- linked to. Deleting the member unlinks them (rule 13) and leaves the
  -- account to be seen again on the next sync as unmatched -- erasing the row
  -- would silently re-add a departed member's +1s to a headcount.
  ADD CONSTRAINT `fk_facebook_accounts_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT `fk_facebook_accounts_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `facebook_event_attendees`
  ADD CONSTRAINT `fk_fb_attendee_event` FOREIGN KEY (`event_id`)
    REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT `fk_fb_attendee_account` FOREIGN KEY (`facebook_account_id`)
    REFERENCES `facebook_accounts`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT `fk_fb_attendee_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
