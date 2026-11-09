/**
 * v1's schema as this import was written against it, derived from the TypeORM
 * entities in the sibling DinnerBears checkout
 * (`api/src/database/entities/*.entity.ts`) rather than from its
 * `docs/DATABASE_SCHEMA.md`, which documents three tables no migration creates
 * (`event_guest_rsvps`, `password_reset_tokens`, `email_verification_tokens`).
 *
 * **This is a fixture, not a source of truth.** The source of truth is the
 * database the import is pointed at, and `preflight()` is what compares the plan
 * against it. What this file buys is that the plan’s completeness is checked by
 * the suite on every run, so a column rule that drifts from v1 is caught here
 * instead of on cutover day with a live connection open.
 *
 * Regenerate it from the entities if v1 gains a column; do not hand-edit it to
 * make a failing test pass, because the test failing is the warning.
 *
 * Two tables are added by hand because they have no entity to read:
 * `migrations`, TypeORM's own ledger, and `release_feedback`, a join table
 * declared with `@JoinTable` on `release.entity.ts` and created by
 * `1749000024000-Phase6NewTables`. Both are certainly in the database, and both
 * are excluded by the plan.
 */
export const V1_SCHEMA: Record<string, readonly string[]> = {
  "achievements": [
    "id",
    "key",
    "name",
    "description",
    "icon",
    "image_path",
    "progress_type",
    "progress_target",
    "event_id",
    "points",
    "title",
    "is_secret",
    "created_at"
  ],
  "announcement_comments": [
    "id",
    "announcement_id",
    "user_id",
    "body",
    "edited_at",
    "created_at",
    "deleted_at"
  ],
  "announcements": [
    "id",
    "title",
    "body",
    "city_id",
    "status",
    "published_at",
    "created_by",
    "created_at",
    "updated_at"
  ],
  "api_tokens": [
    "id",
    "user_id",
    "token_hash",
    "token_prefix",
    "expires_at",
    "last_used_at",
    "revoked_at",
    "created_by",
    "created_at"
  ],
  "app_config": [
    "id",
    "config_key",
    "config_value",
    "description",
    "updated_by",
    "updated_at"
  ],
  "audit_log": [
    "id",
    "user_id",
    "action",
    "entity_type",
    "entity_id",
    "metadata",
    "ip_address",
    "created_at"
  ],
  "avatar": [
    "id",
    "path",
    "label",
    "sort_order",
    "created_at"
  ],
  "cities": [
    "id",
    "name",
    "subdomain",
    "is_active",
    "created_at"
  ],
  "content_flags": [
    "id",
    "content_type",
    "content_id",
    "reported_by",
    "reason",
    "status",
    "reviewed_by",
    "reviewed_at",
    "created_at"
  ],
  "content_reports": [
    "id",
    "reporter_id",
    "content_type",
    "content_id",
    "reason",
    "status",
    "reviewed_by",
    "reviewed_at",
    "created_at"
  ],
  "custom_icons": [
    "id",
    "name",
    "image_path",
    "created_by",
    "created_at"
  ],
  "email_provider_config": [
    "id",
    "brevo_enabled",
    "resend_overflow_enabled",
    "brevo_daily_limit",
    "resend_daily_limit",
    "brevo_sent_today",
    "resend_sent_today",
    "last_reset_date",
    "brevo_api_key",
    "brevo_from_email",
    "brevo_from_name",
    "resend_api_key",
    "resend_from_email",
    "resend_from_name",
    "tmpl_invite",
    "tmpl_security_alert",
    "tmpl_event_published",
    "tmpl_rsvp_confirmation",
    "tmpl_event_reminder",
    "tmpl_account_deletion",
    "tmpl_reengagement_60",
    "tmpl_reengagement_90",
    "tmpl_guest_rsvp_confirmation",
    "tmpl_email_verification",
    "tmpl_password_reset",
    "tmpl_provider_disconnected",
    "tmpl_account_deleted",
    "updated_at"
  ],
  "email_queue": [
    "id",
    "to_email",
    "to_name",
    "subject",
    "template_id",
    "template_params",
    "html_body",
    "text_body",
    "priority",
    "status",
    "provider",
    "attempts",
    "last_attempt_at",
    "error_message",
    "brevo_status",
    "send_after",
    "created_at",
    "sent_at"
  ],
  "email_suppressions": [
    "id",
    "email_hash",
    "reason",
    "created_at"
  ],
  "event_comment_replies": [
    "id",
    "comment_id",
    "member_id",
    "body",
    "edited_at",
    "deleted_at",
    "created_at"
  ],
  "event_comments": [
    "id",
    "event_id",
    "member_id",
    "body",
    "edited_at",
    "deleted_at",
    "created_at"
  ],
  "event_facebook_links": [
    "id",
    "event_id",
    "facebook_event_id",
    "facebook_group",
    "last_extracted_at",
    "last_synced_at",
    "last_going_count",
    "created_at"
  ],
  "event_guest_links": [
    "id",
    "event_id",
    "created_by",
    "member_rsvp_id",
    "delivery_type",
    "source",
    "recipient_name",
    "recipient_email",
    "token",
    "expires_at",
    "used_at",
    "cancelled_at",
    "attended",
    "created_at"
  ],
  "event_rsvps": [
    "id",
    "event_id",
    "user_id",
    "status",
    "additional_guests",
    "guest_names",
    "bringing_item",
    "source",
    "facebook_guest_names",
    "facebook_guest_count",
    "attended",
    "is_walkin",
    "from_other_city",
    "created_at",
    "updated_at"
  ],
  "events": [
    "id",
    "city_id",
    "location_id",
    "location_name",
    "location_address",
    "location_lat",
    "location_lng",
    "title",
    "description",
    "additional_info",
    "event_date",
    "event_time",
    "status",
    "is_secret",
    "published_at",
    "cancelled_at",
    "cancelled_reason",
    "facebook_share_text",
    "reservation_assignee_id",
    "reservation_contact_name",
    "reservation_contact_email",
    "reservation_confirmed",
    "reservation_confirmed_by",
    "reservation_confirmed_at",
    "reservation_confirmed_note",
    "reservation_seats_email_sent",
    "reservation_confirm_token",
    "created_by",
    "created_at",
    "updated_at"
  ],
  "facebook_accounts": [
    "id",
    "profile_url",
    "facebook_user_id",
    "display_name",
    "status",
    "user_id",
    "linked_at",
    "linked_by",
    "last_seen_at",
    "created_at",
    "updated_at"
  ],
  "facebook_deletion_requests": [
    "id",
    "facebook_user_id",
    "confirmation_code",
    "dinnerbears_user_id",
    "status",
    "requested_at",
    "completed_at"
  ],
  "facebook_event_attendees": [
    "id",
    "event_id",
    "facebook_account_id",
    "sources",
    "attended",
    "updated_at"
  ],
  "facebook_group_config": [
    "id",
    "name",
    "url",
    "group_id",
    "city_id",
    "group_role",
    "is_active",
    "created_at",
    "updated_at"
  ],
  "feedback": [
    "id",
    "user_id",
    "title",
    "category",
    "body",
    "status",
    "admin_note",
    "release_note",
    "is_private",
    "upvote_count",
    "seen_at",
    "resolved_at",
    "created_at",
    "updated_at"
  ],
  "feedback_notes": [
    "id",
    "feedback_id",
    "author_id",
    "content",
    "is_admin_only",
    "created_at"
  ],
  "feedback_upvotes": [
    "id",
    "feedback_id",
    "member_id",
    "created_at"
  ],
  "invites": [
    "id",
    "token",
    "type",
    "created_by",
    "city_id",
    "event_id",
    "invite_flavor",
    "facebook_group_id",
    "bound_to_email",
    "bound_to_name",
    "redeemed_by",
    "redeemed_at",
    "guest_rsvp_id",
    "expires_at",
    "is_revoked",
    "max_uses",
    "use_count",
    "created_at"
  ],
  "location_photos": [
    "id",
    "location_id",
    "file_path",
    "file_name",
    "mime_type",
    "sort_order",
    "uploaded_by",
    "created_at"
  ],
  "location_ratings": [
    "id",
    "member_id",
    "event_id",
    "location_id",
    "food",
    "service",
    "value_rating",
    "noise",
    "comment",
    "created_at",
    "updated_at"
  ],
  "locations": [
    "id",
    "name",
    "address",
    "lat",
    "lng",
    "phone",
    "website_url",
    "description",
    "city_id",
    "is_active",
    "is_private",
    "is_residence",
    "imported_from",
    "created_at",
    "updated_at",
    "enriched_at",
    "created_by",
    "updated_by",
    "moderator_notes",
    "contact_name",
    "contact_phone",
    "contact_email"
  ],
  "login_sessions": [
    "id",
    "user_id",
    "jwt_jti",
    "user_agent",
    "ip_address",
    "country",
    "city",
    "is_active",
    "last_active_at",
    "created_at"
  ],
  "member_achievements": [
    "id",
    "member_id",
    "achievement_id",
    "earned_at",
    "seen_at"
  ],
  "member_points": [
    "id",
    "user_id",
    "point_type",
    "reference_id",
    "points",
    "awarded_at"
  ],
  "merch_config": [
    "id",
    "store_url",
    "founding_bear_product_url",
    "updated_at"
  ],
  "migrations": [
    "id",
    "timestamp",
    "name"
  ],
  "notification_preferences": [
    "id",
    "user_id",
    "email_invite",
    "email_verification",
    "email_password_reset",
    "email_password_changed",
    "email_security_alert",
    "email_event_published",
    "email_rsvp_confirmation",
    "email_event_reminder",
    "email_account_deletion",
    "email_reengagement",
    "push_event_published",
    "push_event_reminder",
    "push_announcement",
    "updated_at"
  ],
  "notifications": [
    "id",
    "user_id",
    "type",
    "title",
    "body",
    "action_url",
    "is_read",
    "created_at",
    "read_at"
  ],
  "oauth_accounts": [
    "id",
    "user_id",
    "provider",
    "provider_id",
    "email",
    "profile_url",
    "created_at"
  ],
  "push_subscriptions": [
    "id",
    "user_id",
    "endpoint",
    "p256dh",
    "auth",
    "created_at"
  ],
  "release_feedback": [
    "release_id",
    "feedback_id"
  ],
  "releases": [
    "id",
    "version",
    "title",
    "body",
    "published_at",
    "created_by",
    "created_at",
    "updated_at"
  ],
  "users": [
    "id",
    "full_name",
    "email",
    "email_status",
    "email_verified_at",
    "password_hash",
    "email_verification_token",
    "email_verification_expires_at",
    "password_reset_token",
    "password_reset_expires_at",
    "city_id",
    "role",
    "is_automation_account",
    "has_membership",
    "membership_expires_at",
    "profile_photo_path",
    "status",
    "invited_by",
    "invite_id",
    "invite_source",
    "invite_source_name",
    "last_login_at",
    "login_count",
    "qualifying_login_count",
    "last_qualifying_login_at",
    "failed_login_attempts",
    "login_locked_until",
    "last_failed_login_at",
    "calendar_token",
    "calendar_city_filter",
    "calendar_rsvp_only",
    "calendar_auto_invite",
    "selected_title",
    "last_seen_release_id",
    "last_seen_announcement_id",
    "deleted_at",
    "hard_delete_at",
    "created_at",
    "updated_at"
  ]
};
