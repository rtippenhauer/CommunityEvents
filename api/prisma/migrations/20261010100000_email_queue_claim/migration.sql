-- The dispatcher claim step (v2-27's first half, carved out).
--
-- `email_queue` had no in-flight state: the dispatcher selected `pending`,
-- sent, and only then wrote the outcome. That is safe with exactly one
-- dispatcher and there is already more than one -- Admin -> Send Now calls
-- `dispatchPending` from a request, so pressing it while the cron is mid-run
-- can mail the same row twice.
--
-- Two additions, and neither needs a data backfill: no existing row can be
-- `sending` because the value did not exist until now, so `claimed_at` is
-- legitimately NULL everywhere.

-- `sending` is inserted between `pending` and `sent` rather than appended.
-- MySQL orders an ENUM by declaration, and `ORDER BY status` on this column
-- should read as the row's lifecycle; appending would sort an in-flight message
-- after a cancelled one. Re-declaring the whole set is the only way to say it --
-- MySQL has no "add a value in position" -- and it rewrites no rows, since
-- every existing value keeps both its spelling and its relative order.
ALTER TABLE `email_queue`
  MODIFY COLUMN `status` ENUM('pending','sending','sent','failed','cancelled','blocked')
  NOT NULL DEFAULT 'pending';

-- DATETIME(3), unlike the DATETIME(0) columns beside it: the stale-claim sweep
-- compares this against a cutoff, and whole-second precision would report a
-- claim as up to a second older than it is.
ALTER TABLE `email_queue`
  ADD COLUMN `claimed_at` DATETIME(3) NULL AFTER `send_after`;
