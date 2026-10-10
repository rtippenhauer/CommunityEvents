-- Demo feedback gains a contact, and its label starts identifying the demo
-- (Rob, 2026-10-09): "Should the demo feedback have the email of the person
-- requesting the demo? All demos will have the same name so having the
-- community doesn't help."
--
-- He is right, and the second half is a defect in what shipped. `demo_label`
-- was populated from the community's `brand_name` -- and a demo is seeded from
-- one fixture, so every demo is called "Riverside Community Events". The column
-- identified the TEMPLATE, not the visit, which is the one thing it existed to
-- do. It takes the demo's own host label now, which is unique per demo.
--
-- `submitted_by_email` is new, and is the only personal detail that outlives a
-- demo. It is kept on purpose: it is the sole durable way to reply to a visitor
-- once their community is gone, and the follow-up survey has no other anchor.
-- Denormalised for the same reason as the label -- `submitted_by_user_id` goes
-- NULL when the demo is purged.
--
-- Existing rows keep the fixture name in `demo_label` and have no email; they
-- predate both and cannot be backfilled, since the demos they came from are
-- gone.

ALTER TABLE `demo_feedback`
  ADD COLUMN `submitted_by_email` VARCHAR(255) NULL AFTER `submitted_by_tenant_id`;
