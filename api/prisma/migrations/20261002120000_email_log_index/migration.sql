-- The email log is read newest-first within one community (v2-31), and nothing
-- indexed that: the table had `send_after`, `(status, priority)` and `tenant_id`,
-- all built for the dispatcher picking up work rather than for an operator
-- reading history. Without this, every page of the log is a filesort over the
-- community's whole mail history, which is the one table in the schema that only
-- ever grows.
--
-- Composite and in this order because the query is always scoped to one tenant
-- first and then ordered by date: `tenant_id` alone cannot serve the ORDER BY,
-- and `created_at` alone cannot serve the scope.
ALTER TABLE `email_queue`
  ADD INDEX `idx_email_queue_tenant_created` (`tenant_id`, `created_at`);
