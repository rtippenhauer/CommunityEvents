-- v2-8. Moves a completed OAuth login from the one registered callback host to
-- the community the member actually started on (REQ-TENANT-01.8).
--
-- Google and Meta both require redirect URIs to be registered in advance and
-- neither supports a subdomain wildcard, so every callback terminates on the
-- root host. The session cookie is host-only since v2-6, which means the
-- callback is on the wrong domain to set one. This table holds the single-use
-- ticket that carries the login the last hop.
--
-- Only the SHA-256 of the token is stored, so a read of this table yields
-- nothing that can be redeemed. `tenant_id` defaults to the same sentinel every
-- other scoped table uses -- the foreign key rejects it, so a row created
-- outside a tenant context fails at the database rather than becoming a ticket
-- nobody can account for.
CREATE TABLE `oauth_handoffs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `token_hash`  CHAR(64) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `expires_at`  DATETIME(3) NOT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `tenant_id`   INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_oauth_handoff_token` (`token_hash`),
  INDEX `idx_oauth_handoff_expires` (`expires_at`),
  INDEX `idx_oauth_handoffs_tenant` (`tenant_id`),
  CONSTRAINT `fk_oauth_handoff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_oauth_handoffs_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
