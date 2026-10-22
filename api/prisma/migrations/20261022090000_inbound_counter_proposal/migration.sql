-- "Propose new time" gets its own outcome (v2-34, after stage testing).
--
-- Rob tried Google Calendar's **Propose new time** against stage on
-- 2026-10-21. It arrived as `METHOD:COUNTER`, failed the `METHOD:REPLY` check,
-- and was filed as `not_a_reply` -- which is a correct classification and a
-- useless row. The screen's label for it reads "Not a calendar reply", so a
-- member asking for a different time showed up as though they had sent
-- something irrelevant, and the one actionable fact in the message was thrown
-- away.
--
-- Nothing automates a counter-proposal: a different time means a different
-- event, which is the organiser's decision. The point is that it stops being
-- invisible.
--
-- **APPENDED, not inserted** next to the other calendar outcomes where the
-- lifecycle would read better. The declaration order is the MySQL ENUM order,
-- and appending is the only ENUM change InnoDB can make in place -- inserting
-- mid-list cannot be done INPLACE at all and rebuilds the whole table. The full
-- reasoning is in `20261010100000_email_queue_claim`, which made the same
-- choice for `email_queue.status`. This table is much smaller, but the rule is
-- the rule and the ordering buys nothing: nothing sorts on this column.
--
-- Existing rows are untouched. MySQL converts an ENUM by string, not by stored
-- ordinal, and appending leaves every existing ordinal where it was -- so the
-- two `not_a_reply` rows already on stage stay exactly as they are. They are
-- deliberately NOT rewritten to `counter_proposal`: they record what the
-- deployment concluded at the time, and a log that edits its own history to
-- look tidier is worth less than one that does not.
ALTER TABLE `inbound_emails`
  MODIFY COLUMN `outcome`
  ENUM(
    'recorded',
    'unchanged',
    'invalid_secret',
    'malformed_request',
    'no_ical',
    'not_a_reply',
    'unknown_uid',
    'unparseable_attendee',
    'unhandled_partstat',
    'event_not_found',
    'tenant_mismatch',
    'member_not_found',
    'rate_limited',
    'counter_proposal'
  ) NOT NULL,
  ALGORITHM=INPLACE, LOCK=NONE;
