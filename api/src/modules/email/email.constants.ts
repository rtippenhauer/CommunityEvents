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

export const TEMPLATE_ENV_KEYS: Record<EmailTemplateName, string> = {
  invite: 'BREVO_TEMPLATE_INVITE',
  security_alert: 'BREVO_TEMPLATE_SECURITY_ALERT',
  event_published: 'BREVO_TEMPLATE_EVENT_PUBLISHED',
  rsvp_confirmation: 'BREVO_TEMPLATE_RSVP_CONFIRMATION',
  event_reminder: 'BREVO_TEMPLATE_EVENT_REMINDER',
  account_deletion_warning: 'BREVO_TEMPLATE_ACCOUNT_DELETION',
  reengagement_60: 'BREVO_TEMPLATE_REENGAGEMENT_60',
  reengagement_90: 'BREVO_TEMPLATE_REENGAGEMENT_90',
  guest_rsvp_confirmation: 'BREVO_TEMPLATE_GUEST_RSVP_CONFIRMATION',
  email_verification: 'BREVO_TEMPLATE_EMAIL_VERIFICATION',
  password_reset: 'BREVO_TEMPLATE_PASSWORD_RESET',
  provider_disconnected: 'BREVO_TEMPLATE_PROVIDER_DISCONNECTED',
  account_deleted: 'BREVO_TEMPLATE_ACCOUNT_DELETED',
};

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
