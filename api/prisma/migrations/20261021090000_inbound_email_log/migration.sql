-- The inbound email log (v2-34).
--
-- `v2-31` built "a real email log" and what it built is half of one: the screen
-- reads `email_queue`, where a row is a message *this deployment decided to
-- send*. Inbound mail had no row anywhere in the schema, and the one inbound
-- path returns early on eight separate conditions, every one a `logger.warn` or
-- `logger.debug` and nothing else. The failure mode is a member who pressed
-- Accept in Gmail whose RSVP did not change, with a container log line as the
-- only evidence -- and nobody reads container logs to answer "why is this
-- member not on the list".
--
-- ## Global, with a NULLABLE tenant id
--
-- This is the shape of the table rather than a detail of it. The handler runs
-- outside any request, so there is no ambient tenant: the community is derived
-- from the event that the reply's UID names. When nothing resolves, the row is
-- written with a NULL `tenant_id` anyway, because "this arrived and matched no
-- community" is the single most valuable row on the screen, and it is the shape
-- a multi-tenant fault takes. A scoped table cannot hold that row at all.
--
-- The cost is that the scoping extension injects nothing here, so every
-- tenant-facing read must carry its own `tenant_id` predicate by hand and a
-- forgotten one does not throw -- it shows one community another's mail. The
-- operator's read carries no predicate at all, deliberately, because it has to
-- return exactly the rows no tenant-facing query can.
--
-- ## Why every key is ON DELETE SET NULL
--
-- Three global columns pointing at scoped rows, exactly like `v2-32`'s two
-- tables. `purgeTenantRows` walks only the scoped model list, so a restrictive
-- key would make deleting a community fail on a reply one of its members sent
-- months earlier. Losing the attribution is correct; blocking the delete is not.
--
-- ## Retention: keep everything, for now (Rob, 2026-10-20)
--
-- `v2-31` clears a rendered body after 30 days and keeps the envelope. This
-- keeps both, because inbound volume is a handful of messages a week and the
-- cost of keeping them is nil next to the cost of having deleted the one that
-- explains a cutover fault. "For now" is deliberate and provisional:
-- `email_queue`'s `deepest_open_age_days` instrument exists so a window can be
-- chosen on evidence rather than inherited, and it should decide this one.

CREATE TABLE `inbound_emails` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    -- NULL means the message resolved to no community: operator-visible only.
    `tenant_id` INTEGER UNSIGNED NULL,
    `outcome` ENUM(
        'recorded',
        'unchanged',
        'invalid_secret',
        'malformed_request',
        'no_ical',
        'not_a_reply',
        'unknown_uid',
        'unparseable_attendee',
        'unhandled_partstat',
        'event_not_found',
        'tenant_mismatch',
        'member_not_found',
        'rate_limited'
    ) NOT NULL,
    -- The specific reason where the outcome alone is not actionable: the
    -- unparseable ATTENDEE line, the PARTSTAT we do not handle, which community
    -- a cross-tenant reply actually belonged to. Never a stack trace.
    `detail` VARCHAR(500) NULL,
    `from_address` VARCHAR(255) NULL,
    `to_address` VARCHAR(255) NULL,
    `subject` VARCHAR(500) NULL,
    `event_id` INTEGER UNSIGNED NULL,
    `user_id` INTEGER UNSIGNED NULL,
    -- Plain text, not the `event_rsvps_status` enum: a log records what
    -- happened, and coupling it to a live enum would let a future status change
    -- rewrite the meaning of history.
    `rsvp_status` VARCHAR(20) NULL,
    -- NULL where we deliberately did not keep it. Never stored for a request
    -- that failed authentication -- that body is attacker-supplied content on
    -- an unauthenticated endpoint.
    `raw_body` LONGTEXT NULL,
    -- Always recorded, even when `raw_body` is not: size and source still
    -- answer "what is hitting us", which is the question that matters then.
    `size_bytes` INTEGER UNSIGNED NOT NULL,
    `source_ip` VARCHAR(45) NULL,
    -- How many further identical failures from this source were folded into
    -- this row rather than writing their own. The log has to stay bounded
    -- against an anonymous caller and must not go *quiet* to do it: a counter
    -- that climbs is visible, where a missing row is not.
    `suppressed_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    -- DATETIME(3), unlike the DATETIME(0) columns elsewhere in this schema.
    -- Whole seconds have produced three ordering bugs in this codebase already
    -- (`v2-31`'s unstable pagination and two in `v2-33`), and this table is
    -- written in bursts by definition, since a mail server retrying delivers
    -- several within one second. The `id` tiebreaker in `orderBy` stays anyway.
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    -- The operator's read: every row, newest first, no tenant predicate.
    INDEX `idx_inbound_emails_received`(`received_at`),
    -- A community's own read, and the operator filtering by community.
    INDEX `idx_inbound_emails_tenant_received`(`tenant_id`, `received_at`),
    -- "Show me only the failures", on either read.
    INDEX `idx_inbound_emails_outcome_received`(`outcome`, `received_at`),
    INDEX `fk_inbound_emails_event`(`event_id`),
    INDEX `fk_inbound_emails_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inbound_emails`
  ADD CONSTRAINT `fk_inbound_emails_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT `fk_inbound_emails_event` FOREIGN KEY (`event_id`)
    REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT `fk_inbound_emails_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
