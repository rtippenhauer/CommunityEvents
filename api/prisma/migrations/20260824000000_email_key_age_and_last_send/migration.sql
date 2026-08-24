-- v2-9: enough to tell an operator their sending key is heading for trouble.
--
-- Brevo keys do not expire on their own unless an expiry is chosen when the key
-- is created -- and choosing one, for a credential nothing here can auto-rotate,
-- schedules an outage that needs a human on a particular day. So the deployment
-- does not invent an expiry.
--
-- What it does have to account for is Brevo deactivating a key after 90 days of
-- INACTIVITY. A community that sends little -- a demo, a test community, one
-- between seasons -- crosses that line without anybody doing anything, and the
-- first symptom is mail silently not arriving. These two columns are what lets
-- the admin screen say so beforehand rather than after.

ALTER TABLE `email_provider_config` ADD COLUMN `brevo_api_key_set_at` DATETIME(0) NULL;
ALTER TABLE `email_provider_config` ADD COLUMN `last_successful_send_at` DATETIME(0) NULL;
