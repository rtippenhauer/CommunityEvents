-- The mail-chain self-test's state (v2-48).
--
-- A community's mail chain has five independent legs -- the Brevo key, the
-- verified sender, the template ids, the outbound DNS, and the inbound MX
-- through Cloudflare Email Routing to `POST /calendar/rsvp-reply` -- and until
-- this, the only thing that exercised any of them was a real event mailing real
-- members. Every email defect so far was found in production by a member. This
-- holds what became of one invite sent to the acting admin's own address.
--
-- **On `email_provider_config` rather than in a table of its own.** It is
-- already tenant-scoped with exactly one row per community, which is the
-- cardinality a self-test has; a new table would mean a change to
-- `tenant-scoped-models.ts` for no gain.
--
-- `selftest_nonce` is UNIQUE and deliberately NOT encrypted. The reply arrives
-- with no ambient tenant and finds its community by this value, so it has to be
-- filterable -- and the secret cipher is randomised, which makes an encrypted
-- column impossible to filter on. It is not a credential: it identifies a test,
-- and knowing it lets a holder move one community's self-test state and nothing
-- else. Nullable, and MySQL allows any number of NULLs in a unique index, which
-- is the same trick `root_marker` uses.
ALTER TABLE `email_provider_config`
  ADD COLUMN `selftest_state`
    ENUM('never_run', 'sent', 'delivered', 'passed', 'failed')
    NOT NULL DEFAULT 'never_run',
  ADD COLUMN `selftest_nonce` VARCHAR(64) NULL,
  ADD COLUMN `selftest_email` VARCHAR(255) NULL,
  ADD COLUMN `selftest_message_id` VARCHAR(255) NULL,
  ADD COLUMN `selftest_provider` VARCHAR(20) NULL,
  ADD COLUMN `selftest_sent_at` DATETIME NULL,
  ADD COLUMN `selftest_delivered_at` DATETIME NULL,
  ADD COLUMN `selftest_passed_at` DATETIME NULL,
  ADD COLUMN `selftest_last_reply_at` DATETIME NULL,
  ADD COLUMN `selftest_last_reply_status` VARCHAR(20) NULL,
  ADD COLUMN `selftest_reply_count` INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `selftest_error` VARCHAR(500) NULL,
  ADD UNIQUE INDEX `uq_email_provider_config_selftest_nonce` (`selftest_nonce`);

-- Two more inbound outcomes, **appended** for the reason
-- `20261022090000_inbound_counter_proposal` sets out: declaration order is the
-- MySQL ENUM order, and appending is the one ENUM change InnoDB makes in place.
-- Existing rows keep their values -- MySQL converts by string, not by ordinal.
--
-- Both exist because the value of this log is telling three things apart that
-- would otherwise collapse into one: an operator proving their own setup, a
-- member RSVPing to a real event, and a UID that means nothing to us.
ALTER TABLE `inbound_emails`
  MODIFY COLUMN `outcome`
  ENUM(
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
    'rate_limited',
    'counter_proposal',
    'selftest_reply',
    'selftest_unknown'
  ) NOT NULL,
  ALGORITHM=INPLACE, LOCK=NONE;
