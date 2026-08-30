-- The daily send counters reset on a boundary this deployment draws, and it was
-- drawing it at UTC midnight while the provider account resets on its own
-- schedule. A DATE column can only hold a calendar day, which forces that
-- comparison to be made in some fixed zone; an instant can be compared against
-- whatever `EMAIL_QUOTA_TIMEZONE`'s midnight was, in SQL.
--
-- Existing values are midnights already, so the widening is lossless. Whether
-- the first run after this treats "today" as still open depends on the zone
-- configured, and at worst costs one early counter reset.
ALTER TABLE `email_provider_config`
  MODIFY `last_reset_date` DATETIME(3) NOT NULL;
