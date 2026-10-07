-- Feedback attachments stop being markup (Rob, 2026-10-06):
-- "feedback is storing the screenshot in the text ... Bugs and features treats
-- them as files and not in the description".
--
-- The editor embedded images in `body`, so a screenshot counted against the
-- body's 10,000-character limit. Two of them failed the submit; a report that
-- was only screenshots failed the 10-character minimum instead. Neither limit
-- was wrong -- the size of a picture simply has nothing to do with whether the
-- description says enough, and the two should never have shared a field.
--
-- `system_reports.screenshots` already worked this way. This follows it, with
-- one difference: JSON rather than TEXT, because feedback rows are returned to
-- the client straight from several read paths and Prisma parses a JSON column
-- for all of them, where a text column would need decoding in each.
--
-- Existing bodies keep whatever images they already embed; those render as
-- before. Only new attachments take this column.

ALTER TABLE `feedback`
  ADD COLUMN `screenshots` JSON NULL AFTER `is_private`;
