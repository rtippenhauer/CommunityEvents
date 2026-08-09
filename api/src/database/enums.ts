/**
 * Domain enums, lifted out of the TypeORM entity files as part of the Prisma
 * swap (v2-1).
 *
 * Prisma generates enums of its own, but names them after the database
 * (`users_status.active` rather than `UserStatus.ACTIVE`). Keeping these means
 * the services read the same as before and, more importantly, that the string
 * values written to the database are unchanged -- they are copied verbatim
 * from the entities rather than retyped.
 */

// from achievement.entity.ts
export enum ProgressType {
  ATTENDANCE = 'attendance',
  COORDINATOR = 'coordinator',
  NEW_LOCATION_COORDINATOR = 'new_location_coordinator',
  INVITE = 'invite',
  RATING = 'rating',
  FOUNDING = 'founding',
  EVENT = 'event',
  CITY_HOPPER = 'city_hopper',
  SECRET_DINNER = 'secret_dinner',
  LOGIN = 'login',
}

// from announcement.entity.ts
export enum AnnouncementStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

// from content-flag.entity.ts
export enum FlagContentType {
  ANNOUNCEMENT = 'announcement',
  ANNOUNCEMENT_COMMENT = 'announcement_comment',
}

// from content-flag.entity.ts
export enum FlagStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
}

// from content-report.entity.ts
export enum ReportContentType {
  EVENT_COMMENT = 'event_comment',
  EVENT_COMMENT_REPLY = 'event_comment_reply',
  ANNOUNCEMENT_COMMENT = 'announcement_comment',
  LOCATION_RATING = 'location_rating',
}

// from content-report.entity.ts
export enum ReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
}

// from email-queue.entity.ts
export enum EmailQueueStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  BLOCKED = 'blocked',
}

// from email-queue.entity.ts
export enum EmailProvider {
  BREVO = 'brevo',
  GMAIL = 'gmail',
}

// from email-suppression.entity.ts
export enum SuppressionReason {
  UNSUBSCRIBED = 'unsubscribed',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
}

// from event-rsvp.entity.ts
export enum RsvpStatus {
  GOING = 'going',
  MAYBE = 'maybe',
  NOT_GOING = 'not_going',
}

// from event.entity.ts
export enum EventStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CANCELLED = 'cancelled',
}

// from facebook-deletion-request.entity.ts
export enum FacebookDeletionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

// from facebook-group-config.entity.ts
export enum FacebookGroupRole {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
}

// from feedback.entity.ts
export enum FeedbackCategory {
  BUG = 'bug',
  FEATURE_REQUEST = 'feature_request',
  COMMENT = 'comment',
}

// from feedback.entity.ts
export enum FeedbackStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  SHIPPED = 'shipped',
  CLOSED = 'closed',
  WONT_FIX = 'wont_fix',
}

// from invite.entity.ts
export enum InviteType {
  MEMBER = 'member',
  ADMIN = 'admin',
  CAMPAIGN_FACEBOOK = 'campaign_facebook',
  GUEST_RSVP = 'guest_rsvp',
  SHAREABLE_RSVP = 'shareable_rsvp',
  EVENT_INVITE = 'event_invite',
}

// from invite.entity.ts
export enum InviteFlavor {
  MEMBER = 'member',
  NON_VALIDATED = 'non_validated',
}

// from location.entity.ts
export enum ImportSource {
  MANUAL = 'manual',
  FACEBOOK_IMPORT = 'facebook_import',
}

// from member-point.entity.ts
export enum PointType {
  ATTENDANCE = 'attendance',
  COORDINATOR = 'coordinator',
  NEW_LOCATION_COORDINATOR = 'new_location_coordinator',
  INVITE = 'invite',
  RATING = 'rating',
  CITY_HOPPER = 'city_hopper',
  SECRET_DINNER = 'secret_dinner',
  ACHIEVEMENT = 'achievement',
}

// from oauth-account.entity.ts
export enum OAuthProvider {
  GOOGLE = 'google',
  FACEBOOK = 'facebook',
}

// from user.entity.ts
export enum UserRole {
  NON_VALIDATED = 'non_validated',
  MEMBER = 'member',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
  // Dedicated account for Claude Code automation (release drafting, feedback
  // triage) — a real user row, never an impersonation of an admin. Rob can
  // temporarily reassign it to member/moderator/admin via the normal admin
  // users UI to let it browse role-gated pages for testing, then flip it
  // back. While actually in this role, it's excluded from leaderboards and
  // member lists (once reassigned to member/moderator/admin, it shows up
  // like any other account of that role would).
  AUTOMATION = 'automation',
}

// from user.entity.ts
export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

// from user.entity.ts
export enum EmailStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  UNSUBSCRIBED = 'unsubscribed',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
}

// from user.entity.ts
export enum InviteSource {
  DIRECT = 'direct',
  FACEBOOK_GROUP = 'facebook_group',
  GOOGLE_OAUTH = 'google_oauth',
  NON_VALIDATED_LINK = 'non_validated_link',
}

