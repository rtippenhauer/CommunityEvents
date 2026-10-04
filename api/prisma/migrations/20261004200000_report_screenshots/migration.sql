-- Screenshots on a report (Rob, 2026-10-04, filed through the board itself:
-- "Also I'd like to be able to past a screenshot.").
--
-- Stored as a JSON array of **upload paths**, not URLs. The distinction is the
-- security of the feature: these render as `<img src>` on a board every
-- community's admins read, so an arbitrary URL accepted here would be a
-- tracking pixel that reports who looked at a report and when, to whoever filed
-- it. The DTO accepts only `/api/uploads/<filename>` produced by our own upload
-- route.
--
-- A column rather than a child table: the list is short, bounded at five, always
-- read with its parent and never queried on its own.

ALTER TABLE `system_reports`
  ADD COLUMN `screenshots` TEXT NULL AFTER `admin_note`;
