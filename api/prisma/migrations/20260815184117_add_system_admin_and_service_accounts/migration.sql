-- AlterTable
ALTER TABLE `users` ADD COLUMN `is_service_account` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `role` ENUM('non_validated', 'member', 'moderator', 'admin', 'system_admin', 'automation', 'disabled') NOT NULL DEFAULT 'member';

-- Backfill: the seeded automation account is a service account.
-- Matched on the fixed email because that is the only thing identifying it
-- today -- which is precisely why the column now exists (role is mutable and
-- the email is branding v2-9 will rewrite). This is the last statement that
-- has to know the address.
UPDATE `users`
   SET `is_service_account` = true
 WHERE `email` = 'automation@dinnerbears.internal';
