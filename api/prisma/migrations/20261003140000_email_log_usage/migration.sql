-- How often the email log is reviewed, and how far back (Rob, 2026-10-03).
--
-- Bodies are cleared at 30 days. Whether the ROWS should also go at 6 or 12
-- months is deliberately undecided, because the honest input to that decision
-- is evidence rather than a guess: if nobody has opened anything older than a
-- month, six months is obviously safe; if the log is read a year back, it is
-- not. This table is that evidence.
--
-- One row per community per day, not one per request. A request-level log would
-- be noisy for no gain -- the debounced search fires on every pause in typing --
-- and the question only needs daily granularity.
--
-- `deepest_age_days` is the load-bearing column. "How often" tells you the
-- screen is used; "how far back anyone actually reached" tells you what is safe
-- to delete, which is the question being deferred.
CREATE TABLE `email_log_views` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `viewed_on` DATE NOT NULL,
  `views` INT UNSIGNED NOT NULL DEFAULT 0,
  `deepest_age_days` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_viewed_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_log_view_day` (`tenant_id`, `viewed_on`),
  KEY `idx_email_log_view_tenant` (`tenant_id`),
  CONSTRAINT `fk_email_log_views_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
