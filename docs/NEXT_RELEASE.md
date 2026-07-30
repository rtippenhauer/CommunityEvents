# Next Release — Draft Notes

Running draft of unreleased, customer-facing changes. Appended to automatically
by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
`/release` uses this file as the starting draft and clears it back to empty
once that release's draft has been created.

## Editable Legal & Story Copy

- Terms of Service, Privacy Policy, and the home page's "Our Story" section can now be updated by an admin at any time — no code change or app update required
- Minor cleanup of outdated placeholder pages behind the scenes

## Site Customization & Admin Controls

- Admins can now set the site name, tagline, colors, and logo/splash/icon images right from Site Settings — changes apply instantly, no rebuild
- New events can default to your group's usual day and time
- Locations can keep their address hidden until a member RSVPs "Going"

## Home Page & Branding Controls

- The home page hero, "How it works", and "Our Story" sections are now fully editable from the admin panel — rewrite them, or clear one to hide that section, with no code change
- Toggle the home-page stats bar on or off from Site Settings
- Upload a home-page "Story" image and manage the preset profile avatars members can choose from
- Site colors now flow through the whole interface automatically from your chosen primary color

## Group Terminology & Location Privacy

- Admins can rename the core terms the site uses — "Restaurant", "Dinner", and "Bear Points" — to whatever fits your group
- Locations can be marked as a private residence, so they're treated as a home rather than looked up as a business
- Private venues now keep their photos hidden — not just the address — until a member RSVPs "Going"
- More of the app, including invitation emails, now reflects your group's own name and branding

## Built for Other Groups, Not Just Us

The whole site can now be relaunched under a different group's name, colors, and terminology while keeping the same look, feel, and features that make it work — so other organizations can run their own version without starting from scratch.

- Every email a member receives — event invitations, RSVP confirmations, reminders, and calendar invites — now uses your group's own name instead of being hardcoded
- Admins can turn specific site features (Ratings, the {{points}} Leaderboard, the Merch store, the Members directory) on or off to match what their group actually wants to offer
- The "Founding Member" language across badges, merch, and achievements now consistently matches each group's own branding
- {{locations}} marked as private now show a clear "Private until RSVP" cover on their photos, matching how private {{events}} already work
- Release notes like this one are now generated automatically as part of shipping new updates — so what's new is always accurate and up to date, without manual publishing

## Reliability Fixes

- Fixed an issue where saving Site Settings with several changes at once could fail partway through and need a retry
- Transactional emails (RSVP confirmations, invitations, reminders) now always show your group's own uploaded logo instead of the default one

## Membership Fees & Residence Potlucks

- Admins can now require an active membership to RSVP "Going" — turn it on in Site Settings, then mark each member's membership status and expiration from the Members page. Every member's first {{events}} is always free before this kicks in
- Memberships run on a calendar year and expire January 1
- For {{events}} at a residence, members can now say what they're bringing when they RSVP "Going" — it shows right next to their name on the guest list, so nobody shows up with three bags of chips and no dip
