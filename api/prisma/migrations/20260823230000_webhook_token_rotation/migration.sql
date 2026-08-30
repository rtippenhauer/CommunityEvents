-- v2-9: the per-community Brevo webhook token, and what rotating it needs.
--
-- The token authenticates inbound deliverability events. Rotation is automatic
-- (a scheduled job re-registers through Brevo's API) rather than expiring and
-- waiting for a human, because the failure mode of an expired token is silent
-- and harmful: callbacks start being rejected, bounces stop suppressing dead
-- addresses, and mail keeps going to them -- which is what gets a sending domain
-- blocked. A rotation nobody has to act on cannot be missed.
--
-- `webhook_secret_previous` is the same idea as SECRET_ENCRYPTION_KEYS_RETIRED:
-- the outgoing value still verifies for a short window so a callback already in
-- flight when the swap happens is not rejected.

ALTER TABLE `email_provider_config` ADD COLUMN `webhook_secret_previous` VARCHAR(500) NULL;
ALTER TABLE `email_provider_config` ADD COLUMN `webhook_rotated_at` DATETIME(0) NULL;
ALTER TABLE `email_provider_config` ADD COLUMN `webhook_error` VARCHAR(500) NULL;
