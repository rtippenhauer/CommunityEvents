-- v2-29: non-person account addresses name their own community.
--
-- Both the service account (`automation@communityevents.internal`) and the
-- integration accounts (`<name>@integration.invalid`) carried one
-- deployment-wide domain, so every community's rows were addressed at the
-- platform. An admin reading their own Automation Accounts screen saw an
-- address that looked like it belonged to another community and reasonably
-- read a correctly-scoped row as a cross-tenant leak.
--
-- This rename is NOT cosmetic. `createServiceAccount` upserts
-- ON DUPLICATE KEY UPDATE against `(tenant_id, email)`, so a deployment whose
-- stored rows still hold the old address would grow a SECOND service account
-- on the next bootstrap rather than updating the one it has. That is exactly
-- what v2-10 recorded when this address last changed, and it is why the code
-- change and this migration must ship together.
--
-- Addresses are derived from `tenants.slug` rather than `tenants.domain`: a
-- community can move host, and an address built from the old one would stop
-- saying whose it is.

-- The service account, one per community.
UPDATE users u
  JOIN tenants t ON t.id = u.tenant_id
  SET u.email = CONCAT('automation@', t.slug, '.internal')
  WHERE u.is_service_account = 1
    AND u.email = 'automation@communityevents.internal';

-- Integration accounts (Muse and anything added beside it). The local part is
-- kept: it is the name the admin chose, and only the domain was wrong.
UPDATE users u
  JOIN tenants t ON t.id = u.tenant_id
  SET u.email = CONCAT(SUBSTRING_INDEX(u.email, '@', 1), '@', t.slug, '.internal')
  WHERE u.is_service_account = 1
    AND u.email LIKE '%@integration.invalid';
