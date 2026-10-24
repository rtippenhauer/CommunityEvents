-- The Muse role and integration bearer tokens (v2-29).
--
-- Muse is an outside app that creates the community's Facebook events, reads
-- their Going lists and posts invite links there. It needs an account to act as
-- and a credential to present; this migration is both, and nothing else.
--
-- ## "Exactly one non-human account per tenant" is relaxed here, deliberately
--
-- CLAUDE.md describes `users.is_service_account` as marking "the one non-human
-- account per tenant", and Muse is a second. Nothing ever enforced the
-- singularity -- the column is a plain boolean with no unique index -- so this
-- is a change of wording rather than of structure, and it follows what v1's own
-- Phase 39 did: its `is_automation_account` comment reads "a non-person account
-- (Claude's automation account, Muse's sync account)".
--
-- So the column marks a *class* and the role says which integration. That is
-- what makes the existing protections apply to Muse for free, because all three
-- are predicates on the column rather than lookups of one row:
-- `assertNotServiceAccount` (ban, force-ban, admin delete, self-delete),
-- `EXCLUDE_SERVICE_ACCOUNTS` (directory, leaderboard, member search) and
-- `AUTO_DELETE_ELIGIBLE` (the inactivity sweep, which is the one that would
-- actually have fired -- an integration account never logs in).
--
-- One consequence had to be checked rather than assumed: `OperatorGuard` grants
-- deployment-operator rights on `is_service_account` alone, so a Muse account on
-- the root tenant would satisfy it. It is unreachable, because nothing can mint
-- a session for one of these accounts -- `password_hash` is NULL and both login
-- and password reset refuse a NULL hash, `automationLogin` looks up one fixed
-- address, and there is no OAuth link. A token opens only `/muse`. That is
-- pinned by a test rather than left resting on this paragraph.
--
-- ## The token identifies the community, not the Host header
--
-- This is the one part of Phase 39 that could not be ported literally, because
-- v1 is single-tenant and had nothing to resolve. An integration call carries no
-- session and no cookie, so `api_tokens.tenant_id` is what tells us which
-- community a call belongs to, and `MuseTenantMiddleware` enters that scope from
-- the token's own row before any handler runs.
--
-- It is also what keeps Muse per-community without the operator joining
-- everybody's Facebook groups: a community's own admin runs their own Muse,
-- against their own Facebook account and their own groups, reaching only their
-- own data. Note there is no Facebook credential anywhere in this migration, and
-- there must not be one later -- `tenant_secrets` is the right home if app-level
-- credentials ever become genuinely necessary.
--
-- ## Only the hash is stored
--
-- A database dump cannot be replayed against the API, and a lost token cannot be
-- recovered, only reissued. `token_prefix` exists so a screen can say *which*
-- token without holding one. Deliberately not an `encrypted-columns.ts` column:
-- a hash is already irreversible, and an encrypted column cannot be filtered on
-- (the cipher is randomised), which is exactly what the guard's lookup does.

ALTER TABLE `users`
    MODIFY `role` ENUM(
        'non_validated',
        'member',
        'moderator',
        'admin',
        'system_admin',
        'automation',
        'muse',
        'disabled'
    ) NOT NULL DEFAULT 'member';

CREATE TABLE `api_tokens` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER UNSIGNED NOT NULL,
    -- SHA-256 of the presented token, hex. The guard's only lookup key.
    `token_hash` CHAR(64) NOT NULL,
    -- The leading `cet_xxxxxxxx`, for display. Never enough to authenticate.
    `token_prefix` VARCHAR(16) NOT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `last_used_at` DATETIME(0) NULL,
    `revoked_at` DATETIME(0) NULL,
    -- The admin who issued it. A plain column with no foreign key, matching v1
    -- -- and for the reason v2-34 found by testing: a restrictive key would make
    -- deleting that admin fail, and a cascade would revoke a live integration
    -- because somebody left the community. Nothing joins on it.
    `created_by` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- The sentinel DEFAULT 0 every scoped table carries: it is not a valid
    -- tenant, so a create that escapes the scoping extension is rejected by the
    -- foreign key below rather than landing in some community.
    `tenant_id` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    UNIQUE INDEX `uq_api_tokens_token_hash`(`token_hash`),
    INDEX `idx_api_tokens_user`(`user_id`),
    INDEX `idx_api_tokens_tenant`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `api_tokens`
  -- RESTRICT, like every other scoped table's tenant key: `purgeTenantRows`
  -- walks the scoped model list explicitly, so this failing loudly is how we
  -- find out if `api_tokens` was ever left off that list.
  ADD CONSTRAINT `fk_api_tokens_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- Cascade: a deleted account's tokens must not outlive it. Integration
  -- accounts cannot be deleted today, so this fires only if that changes.
  ADD CONSTRAINT `fk_api_tokens_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
