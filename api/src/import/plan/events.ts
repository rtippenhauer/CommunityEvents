import { toDateColumn, toTimeColumn } from '../../common/utils/prisma-date.util';
import { copy, custom, fk, type TablePlan } from '../plan-types';

/**
 * Venues, dinners and everything attached to one (REQ-IMPORT-01.3).
 *
 * Order within the group is forced by the foreign keys: `locations` before
 * `events` (an event names the venue it was booked at), `events` before RSVPs
 * and comments, and `event_rsvps` before `event_guest_links`, whose
 * `member_rsvp_id` says which member's +1 a guest link belongs to.
 *
 * No cycles here, so no backfill passes — every reference points strictly
 * backwards once the group is in this order.
 */

/**
 * Venues, renamed from v1's Restaurants long before the rewrite.
 *
 * The four moderator-only columns come across with the rest. They are `omit`ed
 * by default on the way *out* in v2 — a global omit in `PrismaService` so a
 * newly written query is safe by default — which has no bearing on writing
 * them, but does mean a validation read will not show them back.
 */
export const locationsPlan: TablePlan = {
  source: 'locations',
  model: 'locations',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    name: copy('name'),
    address: copy('address'),
    lat: copy('lat'),
    lng: copy('lng'),
    phone: copy('phone'),
    website_url: copy('websiteUrl'),
    description: copy('description'),
    city_id: fk('cityId', 'cities', false),
    is_active: copy('isActive'),
    is_private: copy('isPrivate'),
    is_residence: copy('isResidence'),
    imported_from: copy('importedFrom'),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
    enriched_at: copy('enrichedAt'),
    created_by: fk('createdById', 'users', false),
    updated_by: fk('updatedById', 'users', false),
    moderator_notes: copy('moderatorNotes'),
    contact_name: copy('contactName'),
    contact_phone: copy('contactPhone'),
    contact_email: copy('contactEmail'),
  },
  note: 'Before events: an event names the venue it was booked at.',
};

export const locationPhotosPlan: TablePlan = {
  source: 'location_photos',
  model: 'location_photos',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    location_id: fk('locationId', 'locations', true),
    // The file itself is copied by the operator, not by this script: both
    // deployments serve `/api/uploads/locations`, so the stored path stays
    // correct and the import does not need to rewrite it. A missing file shows
    // as a broken image, not as bad data.
    file_path: copy('filePath'),
    file_name: copy('fileName'),
    mime_type: copy('mimeType'),
    sort_order: copy('sortOrder'),
    // NOT NULL in both schemas: a photo always names who uploaded it.
    uploaded_by: fk('uploadedBy', 'users', true),
    created_at: copy('createdAt'),
  },
};

/**
 * Dinners. The widest table in the import, and the one whose foreign keys reach
 * furthest: a city, a venue, an author, a reservation coordinator and whoever
 * confirmed the booking.
 *
 * `location_name`/`location_address`/`location_lat`/`location_lng` are copied as
 * free text rather than resolved through `locations`. v1 denormalises them onto
 * the event on purpose, so a dinner keeps the address it was actually held at
 * even after the venue row is edited or retired — a historical record, not a
 * stale duplicate.
 */
export const eventsPlan: TablePlan = {
  source: 'events',
  model: 'events',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    city_id: fk('cityId', 'cities', false),
    location_id: fk('locationId', 'locations', false),
    location_name: copy('locationName'),
    location_address: copy('locationAddress'),
    location_lat: copy('locationLat'),
    location_lng: copy('locationLng'),
    title: copy('title'),
    description: copy('description'),
    additional_info: copy('additionalInfo'),

    // The one pair in this import where Prisma 7's conversion rules bite — see
    // "Prisma 7 mechanics" in docs/DATABASE_SCHEMA.md. Both are read from the
    // source as strings (`dateStrings: ['DATE']`, and mysql2 returns TIME as a
    // string already) and anchored to UTC on the way in by the same two helpers
    // the rest of the codebase writes these columns with.
    event_date: custom('DATE: string -> UTC-anchored Date via toDateColumn.'),
    event_time: custom('TIME: string -> 1970-01-01 Date via toTimeColumn.'),

    status: copy('status'),
    is_secret: copy('isSecret'),
    published_at: copy('publishedAt'),
    cancelled_at: copy('cancelledAt'),
    cancelled_reason: copy('cancelledReason'),
    facebook_share_text: copy('facebookShareText'),
    reservation_assignee_id: fk('reservationAssigneeId', 'users', false),
    reservation_contact_name: copy('reservationContactName'),
    reservation_contact_email: copy('reservationContactEmail'),
    reservation_confirmed: copy('reservationConfirmed'),
    // A typed-in name, not a user id: VARCHAR(255) in v1 (migration
    // 1750300001000) and String? in v2. Importing it as an FK read
    // "Charles Nottingham" as an id and wrote NULL over it.
    reservation_confirmed_by: copy('reservationConfirmedBy'),
    reservation_confirmed_at: copy('reservationConfirmedAt'),
    reservation_confirmed_note: copy('reservationConfirmedNote'),
    reservation_seats_email_sent: copy('reservationSeatsEmailSent'),
    reservation_confirm_token: copy('reservationConfirmToken'),
    // NOT NULL in both schemas: a dinner always names its author.
    created_by: fk('createdById', 'users', true),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
  transform: (row) => ({
    action: 'write',
    data: {
      // Anchored to UTC rather than parsed loosely, so they round-trip through
      // `toDateString`/`toTimeString` unchanged. Parsing '2026-03-14' without
      // the explicit Z applies the host's offset, which moves the dinner to the
      // previous day in any negative-offset timezone — the exact bug
      // `toEventDateStrings` exists to stop on the read side.
      eventDate: toDateColumn(String(row['event_date'])),
      eventTime: toTimeColumn(String(row['event_time'])),
    },
  }),
  note: 'After locations and users; before every RSVP, comment and rating.',
};

export const eventRsvpsPlan: TablePlan = {
  source: 'event_rsvps',
  model: 'event_rsvps',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    event_id: fk('eventId', 'events', true),
    user_id: fk('userId', 'users', true),
    status: copy('status'),
    additional_guests: copy('additionalGuests'),
    guest_names: copy('guestNames'),
    bringing_item: copy('bringingItem'),
    // Phase 39's ownership marker: the Facebook sync may only remove RSVPs it
    // created itself, and the moment a member touches their own it becomes
    // member-owned for good. Carrying it wrong would let the sync delete
    // members' RSVPs, so it is copied rather than defaulted.
    source: copy('source'),
    facebook_guest_names: copy('facebookGuestNames'),
    facebook_guest_count: copy('facebookGuestCount'),
    attended: copy('attended'),
    is_walkin: copy('isWalkin'),
    from_other_city: copy('fromOtherCity'),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
  note: 'Before event_guest_links, which point at a member RSVP.',
};

/**
 * Guest invite links — a member's +1s by email or shareable link, and public
 * RSVP links.
 *
 * `attended` is the one column here that carries member-visible history: a
 * moderator marking a guest present for somebody with no account. It survives
 * the absence of v1's documented-but-never-created `event_guest_rsvps` table,
 * which is why that table's absence costs nothing — see the invites plan.
 */
export const eventGuestLinksPlan: TablePlan = {
  source: 'event_guest_links',
  model: 'event_guest_links',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    event_id: fk('eventId', 'events', true),
    created_by: fk('createdById', 'users', false),
    member_rsvp_id: fk('memberRsvpId', 'event_rsvps', false),
    delivery_type: copy('deliveryType'),
    source: copy('source'),
    recipient_name: copy('recipientName'),
    recipient_email: copy('recipientEmail'),
    token: copy('token'),
    expires_at: copy('expiresAt'),
    used_at: copy('usedAt'),
    cancelled_at: copy('cancelledAt'),
    attended: copy('attended'),
    created_at: copy('createdAt'),
  },
};

export const eventCommentsPlan: TablePlan = {
  source: 'event_comments',
  model: 'event_comments',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    event_id: fk('eventId', 'events', true),
    member_id: fk('memberId', 'users', true),
    body: copy('body'),
    edited_at: copy('editedAt'),
    // Soft-deleted comments import as deleted. Excluding them would renumber
    // nothing but would drop the replies hanging off them.
    deleted_at: copy('deletedAt'),
    created_at: copy('createdAt'),
  },
};

export const eventCommentRepliesPlan: TablePlan = {
  source: 'event_comment_replies',
  model: 'event_comment_replies',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    comment_id: fk('commentId', 'event_comments', true),
    member_id: fk('memberId', 'users', true),
    body: copy('body'),
    edited_at: copy('editedAt'),
    deleted_at: copy('deletedAt'),
    created_at: copy('createdAt'),
  },
};

/**
 * Member ratings of a venue, one per member per event visit.
 *
 * Carries three foreign keys that must all land in the new tenant, which makes
 * it one of the samples REQ-IMPORT-01.5 checks explicitly.
 */
export const locationRatingsPlan: TablePlan = {
  source: 'location_ratings',
  model: 'location_ratings',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    member_id: fk('memberId', 'users', true),
    event_id: fk('eventId', 'events', true),
    location_id: fk('locationId', 'locations', true),
    food: copy('food'),
    service: copy('service'),
    value_rating: copy('valueRating'),
    noise: copy('noise'),
    comment: copy('comment'),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
};

/**
 * The Facebook mirror's three tables (v2-29, v1 Phase 39).
 *
 * All three are tenant-scoped in v2, and the scoping is load-bearing rather
 * than incidental: two communities may legitimately hold rows for the *same*
 * Facebook event or person, which is why those uniques carry the tenant. An
 * import that wrote them unscoped would collide with any other community that
 * had mirrored the same event.
 */
export const eventFacebookLinksPlan: TablePlan = {
  source: 'event_facebook_links',
  model: 'event_facebook_links',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    event_id: fk('eventId', 'events', true),
    facebook_event_id: copy('facebookEventId'),
    facebook_group: copy('facebookGroup'),
    last_extracted_at: copy('lastExtractedAt'),
    last_synced_at: copy('lastSyncedAt'),
    last_going_count: copy('lastGoingCount'),
    created_at: copy('createdAt'),
  },
};

export const facebookAccountsPlan: TablePlan = {
  source: 'facebook_accounts',
  model: 'facebook_accounts',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    profile_url: copy('profileUrl'),
    facebook_user_id: copy('facebookUserId'),
    display_name: copy('displayName'),
    status: copy('status'),
    // Nullable: an account seen on a Going list that nobody has linked to a
    // member yet is the normal case, and `status` says which.
    user_id: fk('userId', 'users', false),
    linked_at: copy('linkedAt'),
    linked_by: fk('linkedBy', 'users', false),
    last_seen_at: copy('lastSeenAt'),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
};

export const facebookEventAttendeesPlan: TablePlan = {
  source: 'facebook_event_attendees',
  model: 'facebook_event_attendees',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    event_id: fk('eventId', 'events', true),
    facebook_account_id: fk('facebookAccountId', 'facebook_accounts', true),
    sources: copy('sources'),
    attended: copy('attended'),
    updated_at: copy('updatedAt'),
  },
};
