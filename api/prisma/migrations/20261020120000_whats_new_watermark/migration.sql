-- A watermark for the "what's new" splash, instead of id equality.
--
-- `whats-new.service` asked "is the latest release a different row from the
-- one you dismissed" -- `latestRelease.id !== user.lastSeenReleaseId`. That is
-- only the same question as "have you seen it" while the latest release can
-- never change to an OLDER row, and it can: `releases.unpublish` sets
-- `published_at` back to NULL, so unpublishing 2.0.0 makes 1.6.3 latest again.
-- A member who dismissed 2.0.0 holds id 165, the query now returns id 188, and
-- 188 !== 165 reads as unseen -- so every member in the community is
-- re-announced a release they already dismissed, and there is no gesture that
-- clears it other than dismissing the old one again. Deleting the newest
-- release does the same thing without any unpublishing involved.
--
-- The ids cannot answer it even in principle: `releases` ids follow IMPORT
-- order, not publish order, so 188 is both newer as a row and older as a
-- release. Only the publish date orders releases the way members experience
-- them, which is also the order the member-facing queries already sort by.
--
-- So each pointer gains the publish date of the row it points at, and the
-- comparison becomes `(published_at, id) > (last_seen_*_at, last_seen_*_id)` --
-- the same tuple those queries order by, so the id keeps breaking DATETIME(0)
-- ties and stops being asked to carry the whole decision.
--
-- DATETIME(0), matching `releases.published_at` and `announcements.published_at`
-- exactly: a watermark at finer precision than the column it is copied from
-- would compare unequal to its own source.
--
-- Appended rather than placed next to the ids they belong with, and no LOCK
-- clause, for the reasons set out at length in
-- `20261010100000_email_queue_claim` -- INSTANT is the metadata-only path and
-- MySQL rejects a LOCK clause beside it.
ALTER TABLE `users`
  ADD COLUMN `last_seen_release_at` DATETIME(0) NULL,
  ADD COLUMN `last_seen_announcement_at` DATETIME(0) NULL,
  ALGORITHM=INSTANT;

-- Backfilled, because the alternative is visible to every member. A NULL
-- watermark has to mean "no date to compare" and falls back to the old id
-- check; leaving every existing row NULL would be harmless but would also
-- leave the defect in place until each member next dismissed something.
-- The join supplies the date from the very row the pointer names.
--
-- A member whose dismissed release is already unpublished (or deleted, which
-- NULLs the pointer) stays NULL: there is genuinely no date for it, and that
-- member is in the one state this fix cannot reconstruct. Their next dismissal
-- sets the watermark and they leave it for good.
UPDATE `users` u
  JOIN `releases` r ON r.`id` = u.`last_seen_release_id`
  SET u.`last_seen_release_at` = r.`published_at`
  WHERE r.`published_at` IS NOT NULL;

UPDATE `users` u
  JOIN `announcements` a ON a.`id` = u.`last_seen_announcement_id`
  SET u.`last_seen_announcement_at` = a.`published_at`
  WHERE a.`published_at` IS NOT NULL;
