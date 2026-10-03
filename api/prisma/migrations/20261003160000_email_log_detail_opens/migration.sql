-- Opening a message is a stronger signal than scrolling the list (Rob,
-- 2026-10-03).
--
-- `views` counts requests for the LIST, which includes every filter change and
-- every pause in typing while searching -- useful for "is this screen used",
-- weak evidence for "was this message needed". Expanding a row to read its body
-- is a deliberate act with a specific message behind it, so it is counted
-- separately, with its own depth.
--
-- `deepest_open_age_days` is the column a retention decision should actually
-- turn on: the age of the oldest message anybody has opened, as opposed to
-- merely scrolled past.
ALTER TABLE `email_log_views`
  ADD COLUMN `opens` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `views`,
  ADD COLUMN `deepest_open_age_days` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `deepest_age_days`;
