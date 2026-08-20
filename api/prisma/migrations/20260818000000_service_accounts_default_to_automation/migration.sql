-- Service accounts hold `automation` on every tenant, not just the root one.
--
-- They used to be created `disabled` outside the root tenant, on the reasoning
-- that those communities have no automation to run and an `automation` role
-- there would be an escalation path (admin.service.setRole permits promoting an
-- automation account to admin).
--
-- That produced a worse outcome than the risk it avoided. An account named
-- "Claude Automation" showing the role `disabled` reads as something broken, on
-- exactly the screen an operator checks when a community looks wrong -- which is
-- how it was found. And the escalation was never reachable: these accounts have
-- a NULL password_hash and no OAuth link, and AuthService.automationLogin admits
-- the root tenant's account only, so promoting a non-root one to admin produces
-- an admin nobody can authenticate as.
--
-- The protection is kept, moved somewhere it holds regardless of role: setRole
-- now refuses to change ANY non-root service account's role, rather than relying
-- on it happening to sit at `disabled`.
--
-- Data-only migration. Existing deployments already carry these rows, and
-- re-running provisioning would not fix them: createServiceAccount's
-- ON DUPLICATE KEY UPDATE deliberately touches only is_service_account, so that
-- re-provisioning cannot undo the root account's role flip mid-test.
--
-- Narrow on purpose. Restricted to `disabled` so it cannot disturb an account
-- deliberately sitting at admin or system_admin, and to is_service_account so it
-- cannot reach a human account someone parked at `disabled`.
UPDATE users
   SET role = 'automation'
 WHERE is_service_account = 1
   AND role = 'disabled';
