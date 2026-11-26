-- Move and cancel the calendar entry an invite already created (v2-50).
--
-- Two changes, and the first is the one that makes the second worth having.
--
-- `email_queue.attachments` exists because `EmailService.queue()` accepted
-- `attachments` on its DTO and had nowhere to put them. Only the immediate path
-- (`sendNow` -> `sendBranded`) ever reached a provider with a file attached, so
-- attaching a calendar invite to anything queued was a silent no-op whose queue
-- row still looked perfectly correct -- there was no column for a test to find
-- missing. It was already costing deliveries on the path that works:
-- `sendNow` falls back to `queue()` when the provider throws, which turned a
-- publish invite into the same email WITHOUT its invite and recorded it as a
-- successful queue.
--
-- JSON rather than a child table: an attachment has no identity, is never
-- queried, and is read exactly once by the dispatcher that sends the row.
-- Stored as decoded text, not base64 -- the providers encode it themselves, and
-- a pre-encoded blob would hide an `.ics` from the admin log and from anyone
-- debugging a bad invite.
ALTER TABLE `email_queue`
  ADD COLUMN `attachments` JSON NULL AFTER `text_body`;

-- Who was actually SENT a METHOD:REQUEST, and at what SEQUENCE.
--
-- Moving or cancelling a published event has to reach everyone holding a
-- calendar entry an invite created, and that set cannot be recomputed from
-- anything already stored. Auto-invite opt-in changes between publish and
-- change time; the publish sweep skips whoever had already RSVP'd and RSVP rows
-- move afterwards; and `sendingIsBlocked` means a targeted member may never
-- have been sent anything at all, so being in the target set is not the same as
-- holding an entry. `email_queue` cannot answer it either -- `sendNow` writes a
-- row only when the send FAILS, so a delivered invite leaves no trace there.
--
-- Keyed on the email address rather than the user id, with the id kept beside
-- it. The address is the ATTENDEE identity inside the `.ics`, which is what a
-- calendar client matches a later REQUEST or CANCEL against. `user_id` is
-- NULLABLE so that guest-link recipients -- who receive no REQUEST today, since
-- both senders address `users` rows -- can be recorded here unchanged if they
-- ever do.
--
-- `last_sequence` is what makes "strictly higher than the original" checkable
-- rather than assumed from the clock. ON DELETE CASCADE from `users` and not
-- SET NULL: a deleted member must not leave their address behind in this table.
CREATE TABLE `event_calendar_invites` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`      INT UNSIGNED NOT NULL,
  `user_id`       INT UNSIGNED NULL,
  `email`         VARCHAR(255) NOT NULL,
  `last_sequence` INT NOT NULL DEFAULT 0,
  `sent_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id`     INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_event_invite_recipient` (`tenant_id`, `event_id`, `email`),
  INDEX `idx_event_invite_event` (`event_id`),
  INDEX `idx_event_calendar_invites_tenant` (`tenant_id`),
  CONSTRAINT `fk_event_invite_event` FOREIGN KEY (`event_id`)
    REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_event_invite_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_event_calendar_invites_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
