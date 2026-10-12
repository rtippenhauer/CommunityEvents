-- The dispatcher claim step (v2-27's first half, carved out).
--
-- `email_queue` had no in-flight state: the dispatcher selected `pending`,
-- sent, and only then wrote the outcome. That is safe with exactly one
-- dispatcher and there is already more than one -- Admin -> Send Now calls
-- `dispatchPending` from a request, so pressing it while the cron is mid-run
-- can mail the same row twice.
--
-- Two additions, and neither needs a data backfill: no existing row can be
-- `sending` because the value did not exist until now, so `claimed_at` is
-- legitimately NULL everywhere.

-- `sending` is APPENDED, not inserted next to `pending` where the lifecycle
-- would read better. The declaration order is not free:
--
--   * Appending is the one ENUM change InnoDB can make in place. Inserting a
--     value mid-list cannot be done INPLACE at all ("Cannot change column type
--     INPLACE. Try ALGORITHM=COPY") and so rebuilds the whole table, holding a
--     write lock for the duration. Nothing prunes `email_queue` -- v2-31 clears
--     old *bodies* and keeps every envelope -- so this table only ever grows,
--     and at the DinnerBears cutover it is the one that would be biggest. A
--     migration that stops mail while it copies is not worth a tidier
--     `ORDER BY`.
--   * Nothing orders by this column. The log orders by `created_at, id`, the
--     filters are equality, and the one `groupBy(['status'])` does not depend
--     on declaration order for correctness.
--
-- Existing values are preserved either way -- MySQL converts an ENUM by string
-- and not by its stored ordinal, verified against a populated table before
-- choosing this -- but appending also leaves every existing ordinal untouched,
-- so the rewrite has nothing to rewrite.
ALTER TABLE `email_queue`
  MODIFY COLUMN `status`
  ENUM('pending','sent','failed','cancelled','blocked','sending')
  NOT NULL DEFAULT 'pending',
  ALGORITHM=INPLACE, LOCK=NONE;

-- DATETIME(3), unlike the DATETIME(0) columns beside it: the stale-claim sweep
-- compares this against a cutoff, and whole-second precision would report a
-- claim as up to a second older than it is.
--
-- INSTANT, and the clause is doing real work. This statement originally read
-- `AFTER send_after, ALGORITHM=INPLACE, LOCK=NONE`, which looked like the same
-- care taken over the ENUM above and was the opposite: for ADD COLUMN, INPLACE
-- means "rebuild the table but allow concurrent DML", so asserting it opted out
-- of the metadata-only path and rebuilt `email_queue` -- the very thing the
-- comment above refuses to do. Measured on MySQL 9.7.2 via
-- `information_schema.INNODB_TABLES.TOTAL_ROW_VERSIONS`, which counts instant
-- changes: INSTANT gave 1, INPLACE gave 0, meaning the table had been rewritten.
--
-- The column position was never the cost. 9.7 adds a column instantly in any
-- position, `AFTER send_after` included (the "instant add must be last"
-- restriction was lifted in 8.0.29). It is dropped anyway because it bought
-- nothing -- nothing reads this table's columns positionally, Prisma keys
-- everything by name -- and appending keeps the statement instant on 8.0.12
-- through 8.0.28 as well, where the lifted restriction does not yet apply.
--
-- No LOCK clause: MySQL rejects one outright next to ALGORITHM=INSTANT
-- ("Incorrect usage of ALGORITHM=INSTANT and LOCK=NONE"). There is nothing to
-- lock, which is the point.
ALTER TABLE `email_queue`
  ADD COLUMN `claimed_at` DATETIME(3) NULL,
  ALGORITHM=INSTANT;
