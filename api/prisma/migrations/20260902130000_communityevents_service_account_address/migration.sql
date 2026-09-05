-- Rename the service account's address (v2-10).
--
-- `automation@dinnerbears.internal` -> `automation@communityevents.internal`.
--
-- The address is deliberately not an identifier: guards key on
-- `users.is_service_account`, never on this string, precisely so the account
-- can be renamed. But `createServiceAccount` upserts with
-- ON DUPLICATE KEY UPDATE against (tenant_id, email), so without this an
-- existing deployment would insert a SECOND service account on the next
-- bootstrap rather than update the one it already has.
--
-- Scoped to service accounts rather than matching the address alone, so a real
-- member who somehow holds that address is never rewritten. It is not scoped to
-- a tenant: every community that has one needs it renamed, and `email` is
-- unique per (tenant_id, email), so at most one row per community can match.
UPDATE `users`
  SET `email` = 'automation@communityevents.internal'
  WHERE `email` = 'automation@dinnerbears.internal'
    AND `is_service_account` = 1;
