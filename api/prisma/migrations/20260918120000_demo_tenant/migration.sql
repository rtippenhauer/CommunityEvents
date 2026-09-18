-- v2-14: the demo community.
--
-- `is_demo` grants two things that are dangerous anywhere else: self-registration
-- as an admin of this tenant, and a scheduled wipe of everything in it. The CHECK
-- constraint is what makes "impossible to enable on the root tenant" a property of
-- the database rather than of whoever writes the next service.
--
-- Written as raw SQL because Prisma cannot express a CHECK constraint in
-- schema.prisma. It is created by this migration, so replaying the history
-- reproduces it and drift detection stays quiet; MySQL has enforced CHECK
-- constraints since 8.0.16 and stage runs 9.7.
ALTER TABLE `tenants`
  ADD COLUMN `is_demo` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `tenants`
  ADD CONSTRAINT `chk_tenant_demo_not_root` CHECK (NOT (`is_root` = 1 AND `is_demo` = 1));
