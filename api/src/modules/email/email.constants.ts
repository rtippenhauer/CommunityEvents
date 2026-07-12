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
