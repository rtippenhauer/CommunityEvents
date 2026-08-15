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

/**
 * Declared as const objects rather than TypeScript `enum`s.
 *
 * A string enum is nominal: `UserRole.ADMIN` has type `UserRole.ADMIN`, which
 * TypeScript will not assign to Prisma's generated `users_role` union even
 * though both are the string 'admin'. That would mean a cast at every write
 * touching an enum column. The const-object form gives each member a literal
 * string type, so values flow both ways without casts, while `UserRole.ADMIN`
 * and `role: UserRole` keep reading exactly as they did.
 */

// from achievement.entity.ts
export const ProgressType = {
  ATTENDANCE: 'attendance',
  COORDINATOR: 'coordinator',
  NEW_LOCATION_COORDINATOR: 'new_location_coordinator',
  INVITE: 'invite',
  RATING: 'rating',
  FOUNDING: 'founding',
  EVENT: 'event',
  CITY_HOPPER: 'city_hopper',
  SECRET_DINNER: 'secret_dinner',
  LOGIN: 'login',
} as const;
export type ProgressType = (typeof ProgressType)[keyof typeof ProgressType];

// from announcement.entity.ts
export const AnnouncementStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;
export type AnnouncementStatus = (typeof AnnouncementStatus)[keyof typeof AnnouncementStatus];

// from content-flag.entity.ts
export const FlagContentType = {
  ANNOUNCEMENT: 'announcement',
  ANNOUNCEMENT_COMMENT: 'announcement_comment',
} as const;
export type FlagContentType = (typeof FlagContentType)[keyof typeof FlagContentType];

// from content-flag.entity.ts
export const FlagStatus = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  DISMISSED: 'dismissed',
} as const;
export type FlagStatus = (typeof FlagStatus)[keyof typeof FlagStatus];

// from content-report.entity.ts
export const ReportContentType = {
  EVENT_COMMENT: 'event_comment',
  EVENT_COMMENT_REPLY: 'event_comment_reply',
  ANNOUNCEMENT_COMMENT: 'announcement_comment',
  LOCATION_RATING: 'location_rating',
} as const;
export type ReportContentType = (typeof ReportContentType)[keyof typeof ReportContentType];

// from content-report.entity.ts
export const ReportStatus = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  DISMISSED: 'dismissed',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

// from email-queue.entity.ts
export const EmailQueueStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  BLOCKED: 'blocked',
} as const;
export type EmailQueueStatus = (typeof EmailQueueStatus)[keyof typeof EmailQueueStatus];

// from email-queue.entity.ts
export const EmailProvider = {
  BREVO: 'brevo',
  GMAIL: 'gmail',
} as const;
export type EmailProvider = (typeof EmailProvider)[keyof typeof EmailProvider];

// from email-suppression.entity.ts
export const SuppressionReason = {
  UNSUBSCRIBED: 'unsubscribed',
  BOUNCED: 'bounced',
  COMPLAINED: 'complained',
} as const;
export type SuppressionReason = (typeof SuppressionReason)[keyof typeof SuppressionReason];

// from event-rsvp.entity.ts
export const RsvpStatus = {
  GOING: 'going',
  MAYBE: 'maybe',
  NOT_GOING: 'not_going',
} as const;
export type RsvpStatus = (typeof RsvpStatus)[keyof typeof RsvpStatus];

// from event.entity.ts
export const EventStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CANCELLED: 'cancelled',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

// from facebook-deletion-request.entity.ts
export const FacebookDeletionStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
} as const;
export type FacebookDeletionStatus = (typeof FacebookDeletionStatus)[keyof typeof FacebookDeletionStatus];

// from facebook-group-config.entity.ts
export const FacebookGroupRole = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
} as const;
export type FacebookGroupRole = (typeof FacebookGroupRole)[keyof typeof FacebookGroupRole];

// from feedback.entity.ts
export const FeedbackCategory = {
  BUG: 'bug',
  FEATURE_REQUEST: 'feature_request',
  COMMENT: 'comment',
} as const;
export type FeedbackCategory = (typeof FeedbackCategory)[keyof typeof FeedbackCategory];

// from feedback.entity.ts
export const FeedbackStatus = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  SHIPPED: 'shipped',
  CLOSED: 'closed',
  WONT_FIX: 'wont_fix',
} as const;
export type FeedbackStatus = (typeof FeedbackStatus)[keyof typeof FeedbackStatus];

// from invite.entity.ts
export const InviteType = {
  MEMBER: 'member',
  ADMIN: 'admin',
  CAMPAIGN_FACEBOOK: 'campaign_facebook',
  GUEST_RSVP: 'guest_rsvp',
  SHAREABLE_RSVP: 'shareable_rsvp',
  EVENT_INVITE: 'event_invite',
} as const;
export type InviteType = (typeof InviteType)[keyof typeof InviteType];

// from invite.entity.ts
export const InviteFlavor = {
  MEMBER: 'member',
  NON_VALIDATED: 'non_validated',
} as const;
export type InviteFlavor = (typeof InviteFlavor)[keyof typeof InviteFlavor];

// from location.entity.ts
export const ImportSource = {
  MANUAL: 'manual',
  FACEBOOK_IMPORT: 'facebook_import',
} as const;
export type ImportSource = (typeof ImportSource)[keyof typeof ImportSource];

// from member-point.entity.ts
export const PointType = {
  ATTENDANCE: 'attendance',
  COORDINATOR: 'coordinator',
  NEW_LOCATION_COORDINATOR: 'new_location_coordinator',
  INVITE: 'invite',
  RATING: 'rating',
  CITY_HOPPER: 'city_hopper',
  SECRET_DINNER: 'secret_dinner',
  ACHIEVEMENT: 'achievement',
} as const;
export type PointType = (typeof PointType)[keyof typeof PointType];

// from oauth-account.entity.ts
export const OAuthProvider = {
  GOOGLE: 'google',
  FACEBOOK: 'facebook',
} as const;
export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider];

// from user.entity.ts
export const UserRole = {
  NON_VALIDATED: 'non_validated',
  MEMBER: 'member',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  /**
   * Operator of the deployment rather than of one community: the role that
   * manages tenants. Only meaningful on the root tenant -- SystemAdminGuard
   * requires both this role and `req.tenant.isRoot`, so the role alone grants
   * nothing on a tenant that is not the root.
   *
   * Satisfies @Roles(ADMIN) through the hierarchy in RolesGuard, so a system
   * admin does not need a second account to do ordinary admin work.
   */
  SYSTEM_ADMIN: 'system_admin',
  AUTOMATION: 'automation',
  /**
   * No privileges whatsoever. RolesGuard is an allowlist, so this matches no
   * @Roles() and reaches nothing role-gated.
   *
   * Held by the service account on every non-root tenant, which exists only to
   * own the rows the deployment creates for itself. Also usable to park a human
   * account without deleting it.
   */
  DISABLED: 'disabled',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// from user.entity.ts
export const UserStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// from user.entity.ts
export const EmailStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  UNSUBSCRIBED: 'unsubscribed',
  BOUNCED: 'bounced',
  COMPLAINED: 'complained',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

// from user.entity.ts
export const InviteSource = {
  DIRECT: 'direct',
  FACEBOOK_GROUP: 'facebook_group',
  GOOGLE_OAUTH: 'google_oauth',
  NON_VALIDATED_LINK: 'non_validated_link',
} as const;
export type InviteSource = (typeof InviteSource)[keyof typeof InviteSource];

