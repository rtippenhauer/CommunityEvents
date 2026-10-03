/**
 * Why a message went out, for the admin email log (Rob, 2026-10-03).
 *
 * ## Why this is not `templateId`
 *
 * `templateId` looks like the answer and must not be used as one: it is a
 * **dispatch instruction**, not a label. `BrevoService.getTemplateId` turns it
 * into a provider template id, and `checkNotificationPref` turns it into a
 * member's opt-out. Setting one on a message that currently sends raw HTML
 * would switch that message onto a Brevo template wherever
 * `BREVO_TEMPLATE_<NAME>` happens to be configured -- a silent change to what a
 * member receives, caused by adding a column to a screen. And only 4 of the 21
 * send sites set one at all, which is why the log showed "—" for almost
 * everything.
 *
 * So the reason a message exists is recorded separately from how it is
 * delivered, and nothing branches on it. It is written at enqueue time, read by
 * the log, and otherwise inert.
 *
 * Names describe the **event that caused the mail**, not the template that
 * renders it -- that is what an operator is asking when they look at a row they
 * did not expect.
 */
export const EmailCategory = {
  // Account and access
  INVITE: 'invite',
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGED: 'password_changed',
  ACCOUNT_LOCKED: 'account_locked',
  PROVIDER_DISCONNECTED: 'provider_disconnected',
  ACCOUNT_DELETED: 'account_deleted',
  ACCOUNT_DELETION_WARNING: 'account_deletion_warning',
  REENGAGEMENT: 'reengagement',

  // Events
  EVENT_INVITE: 'event_invite',
  EVENT_PUBLISHED: 'event_published',
  EVENT_CHANGED: 'event_changed',
  EVENT_CANCELLED: 'event_cancelled',
  EVENT_REMINDER: 'event_reminder',
  RSVP_CONFIRMATION: 'rsvp_confirmation',
  GUEST_RSVP_CONFIRMATION: 'guest_rsvp_confirmation',

  // Organiser chores
  RESERVATION_REQUEST: 'reservation_request',
  HEADCOUNT_UPDATE: 'headcount_update',

  // The platform writing as itself
  DEMO_CONFIRMATION: 'demo_confirmation',
  DEMO_READY: 'demo_ready',

  /** Anything that predates this column, or a send that named nothing. */
  OTHER: 'other',
} as const;

export type EmailCategoryName = (typeof EmailCategory)[keyof typeof EmailCategory];

export const EmailTemplate = {
  INVITE: 'invite',
  SECURITY_ALERT: 'security_alert',
  EVENT_PUBLISHED: 'event_published',
  RSVP_CONFIRMATION: 'rsvp_confirmation',
  EVENT_REMINDER: 'event_reminder',
  ACCOUNT_DELETION_WARNING: 'account_deletion_warning',
  REENGAGEMENT_60: 'reengagement_60',
  REENGAGEMENT_90: 'reengagement_90',
  GUEST_RSVP_CONFIRMATION: 'guest_rsvp_confirmation',
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
  PROVIDER_DISCONNECTED: 'provider_disconnected',
  ACCOUNT_DELETED: 'account_deleted',
} as const;

export type EmailTemplateName = (typeof EmailTemplate)[keyof typeof EmailTemplate];

export const NOTIFICATION_PREF_KEY: Partial<Record<EmailTemplateName, string>> = {
  invite: 'emailInvite',
  email_verification: 'emailVerification',
  password_reset: 'emailPasswordReset',
  security_alert: 'emailSecurityAlert',
  event_published: 'emailEventPublished',
  rsvp_confirmation: 'emailRsvpConfirmation',
  event_reminder: 'emailEventReminder',
  account_deletion_warning: 'emailAccountDeletion',
  reengagement_60: 'emailReengagement',
  reengagement_90: 'emailReengagement',
};
