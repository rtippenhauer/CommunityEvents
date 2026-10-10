-- Why a message went out, and when its body stops being kept (v2-31 follow-up).
--
-- `category` is deliberately NOT `template_id`. That column is a dispatch
-- instruction -- it selects a Brevo template and a member's opt-out -- so using
-- it as a label would mean a display change could alter what a member receives.
-- Nothing branches on `category`; it is written at enqueue and read by the log.
--
-- Nullable with no default and no backfill: rows that predate this genuinely
-- have no recorded reason, and inventing one by guessing from the subject line
-- would put a wrong answer in a column an operator is about to trust. They read
-- as "Unknown" in the log, which is true.
ALTER TABLE `email_queue`
  ADD COLUMN `category` VARCHAR(50) NULL AFTER `template_params`;

-- Filtering the log by reason, within one community, newest first.
CREATE INDEX `idx_email_queue_tenant_category`
  ON `email_queue` (`tenant_id`, `category`, `created_at`);

-- When the rendered body was cleared, so the retention sweep can tell a message
-- it has already pruned from one it has not yet reached. Without it the sweep
-- cannot be idempotent: an empty body is indistinguishable from a message that
-- never had one (a provider-template send stores none).
ALTER TABLE `email_queue`
  ADD COLUMN `body_cleared_at` DATETIME(0) NULL AFTER `sent_at`;
