-- Demo feedback becomes a survey (Rob, 2026-10-04): "Demo feedback would be a
-- survey and a unique register, only for feedback from demos."
--
-- One free-text box asked the visitor to work out for themselves what was worth
-- saying, which is the commonest reason a feedback form comes back empty or
-- comes back as "it was fine". Structured questions ask for the things that are
-- actually decidable from a week's trial.
--
-- **A separate migration rather than an edit to 20261004142910**, which created
-- these tables one commit earlier. That migration is already inside a pushed
-- `v2-stage` image, so it may have run; Prisma records a checksum per applied
-- migration and editing one in place fails every later deploy against that
-- database with a mismatch that reads as corruption.
--
-- `body` is relaxed to NULL because a visitor who answers the questions and
-- skips the box has still told us something. "At least one answer" is enforced
-- in the service, not here: the database cannot see which combination of
-- columns counts as an answer, and a CHECK constraint naming them would have to
-- be rewritten every time a question is added.

ALTER TABLE `demo_feedback`
  MODIFY COLUMN `body` TEXT NULL,
  ADD COLUMN `would_use` ENUM('yes', 'maybe', 'no') NULL AFTER `rating`,
  ADD COLUMN `what_worked` TEXT NULL AFTER `would_use`,
  ADD COLUMN `what_didnt` TEXT NULL AFTER `what_worked`;
