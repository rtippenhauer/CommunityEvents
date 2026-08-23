/**
 * The Terms of Service and Privacy Policy a community starts with.
 *
 * Every community needs both from the moment it exists: `/terms` and `/privacy`
 * are public routes that render whatever `app_config` holds, and an empty row
 * produced a titled page with nothing under it -- which reads as answered
 * rather than missing.
 *
 * These are **templates, not finished documents**, and the point of seeding
 * them is that the pages are never blank while somebody reviews them. The
 * community's admin is told to do exactly that: `legal_reviewed_at` stays empty
 * until they confirm, and the admin UI says so until it is set.
 *
 * They deliberately describe *this platform's* actual behaviour -- Brevo and
 * Resend as processors, the 30-day recovery window, invite-only registration,
 * what OAuth returns -- because a community admin cannot know or control any of
 * that, and a blank field would invite them to guess. What is genuinely theirs
 * is the name, the contact address and the house rules.
 *
 * `{{brand_name}}`, `{{legal_entity}}` and `{{support_email}}` are filled in at
 * read time by `fillLegalPlaceholders`, so renaming a community does not strand
 * its old name inside two legal documents. An admin who edits the copy keeps
 * whichever placeholders they leave in place.
 */

export const LEGAL_TERMS_DEFAULT_HTML = `<p>
  These Terms of Service ("Terms") govern your use of {{brand_name}}, operated by
  {{legal_entity}}. By accessing or using {{brand_name}}, you agree to these Terms.
</p>

<h2>1. Eligibility &amp; Invite-Only Access</h2>
<p>
  {{brand_name}} is a private, invite-only community. You may only create an account by
  redeeming a valid invite issued by an existing member or administrator. You must be 18
  years of age or older to use the platform.
</p>

<h2>2. Your Account</h2>
<p>
  You are responsible for maintaining the confidentiality of your account credentials and
  for all activity that occurs under your account. You agree to notify us immediately of any
  unauthorized use of your account at
  <a href="mailto:{{support_email}}">{{support_email}}</a>.
</p>

<h2>3. Community Standards</h2>
<p>{{brand_name}} is a community built on mutual respect. You agree not to:</p>
<ul>
  <li>Share your invite link publicly or with people outside the intended community</li>
  <li>Harass, threaten, or abuse other members</li>
  <li>Post spam, fraudulent, or misleading content</li>
  <li>Attempt to circumvent platform security or access controls</li>
  <li>Use the platform for any unlawful purpose</li>
</ul>

<h2>4. RSVPs and Attendance</h2>
<p>
  When you RSVP to an event, your name and RSVP status are visible to other members of that
  community. Please cancel your RSVP promptly if you can no longer attend, as reservations
  are often made based on expected attendance.
</p>

<h2>5. Intellectual Property</h2>
<p>
  The {{brand_name}} platform, including its design, code, and content, is owned by
  {{legal_entity}}. You may not reproduce, distribute, or create derivative works without
  express written permission.
</p>

<h2>6. Account Termination</h2>
<p>
  We reserve the right to suspend or terminate accounts that violate these Terms or the
  spirit of the community. You may request deletion of your account at any time from your
  profile settings. Deleted accounts enter a 30-day recovery window before permanent
  deletion.
</p>

<h2>7. Disclaimer of Warranties</h2>
<p>
  {{brand_name}} is provided "as is" without warranties of any kind. We do not guarantee
  uninterrupted availability of the platform and are not responsible for any venue
  experiences, third-party services, or events organized through the platform.
</p>

<h2>8. Limitation of Liability</h2>
<p>
  To the maximum extent permitted by law, {{legal_entity}} shall not be liable for any
  indirect, incidental, or consequential damages arising from your use of the platform.
</p>

<h2>9. Governing Law</h2>
<p>
  These Terms are governed by the laws of the jurisdiction in which {{legal_entity}} is
  established, without regard to conflict of law principles.
</p>

<h2>10. Changes to These Terms</h2>
<p>
  We may update these Terms from time to time. We will notify registered members of material
  changes via email. Continued use of the platform constitutes acceptance of updated Terms.
</p>

<h2>11. Contact</h2>
<p>
  Questions about these Terms? Contact us at
  <a href="mailto:{{support_email}}">{{support_email}}</a>.
</p>`;

export const LEGAL_PRIVACY_DEFAULT_HTML = `<p>
  {{legal_entity}} operates {{brand_name}}. This Privacy Policy explains how we collect, use,
  and protect your personal information.
</p>

<h2>1. Information We Collect</h2>
<p>We collect the following information when you register and use {{brand_name}}:</p>
<ul>
  <li><strong>Account information:</strong> Your full name, email address, and city.</li>
  <li>
    <strong>Authentication data:</strong> If you sign in via Google or Facebook, we receive
    your name, email address, and profile photo from those providers.
  </li>
  <li>
    <strong>Usage data:</strong> Event RSVPs, login history, device type, and IP address for
    security purposes.
  </li>
  <li><strong>Communications:</strong> Any messages or content you submit through the platform.</li>
</ul>

<h2>2. How We Use Your Information</h2>
<p>We use your information to:</p>
<ul>
  <li>Operate and maintain your {{brand_name}} account</li>
  <li>Send transactional email (event reminders, RSVP confirmations, security alerts)</li>
  <li>Display your RSVP status to other members for event planning purposes</li>
  <li>Maintain platform security and prevent abuse</li>
  <li>Comply with legal obligations</li>
</ul>

<h2>3. Information We Do Not Collect</h2>
<p>
  We do not collect payment information, sell your personal data to third parties, or use
  your data for advertising purposes.
</p>

<h2>4. Information Sharing</h2>
<p>We do not sell, trade, or share your personal information with third parties except:</p>
<ul>
  <li>
    <strong>Service providers:</strong> We use Brevo and Resend to send transactional email
    on our behalf.
  </li>
  <li>
    <strong>Legal requirements:</strong> We may disclose information if required by law or to
    protect the rights and safety of our community.
  </li>
</ul>

<h2>5. Google and Facebook Sign-In</h2>
<p>
  {{brand_name}} may offer optional sign-in via Google and Facebook. If you use these
  features, those providers' privacy policies also apply. We request basic profile
  information (name and email) only, and do not access your contacts, posts, or other account
  data.
</p>

<h2>6. Data Retention</h2>
<p>
  We retain your account data for as long as your account is active. If you request account
  deletion, your account is soft-deleted immediately with a 30-day recovery window. After 30
  days, personally identifiable information is permanently deleted.
</p>

<h2>7. Security</h2>
<p>
  We use encrypted passwords, HTTPS, secure HTTP-only cookies, and encryption at rest for
  stored credentials. No internet transmission is completely secure, and we cannot guarantee
  absolute security.
</p>

<h2>8. Your Rights</h2>
<p>You have the right to:</p>
<ul>
  <li>Access the personal information we hold about you</li>
  <li>Correct inaccurate information in your profile</li>
  <li>Request deletion of your account and associated data</li>
  <li>Opt out of non-essential email</li>
</ul>

<h2>9. Children's Privacy</h2>
<p>
  {{brand_name}} is not intended for users under the age of 18. We do not knowingly collect
  personal information from minors.
</p>

<h2>10. Changes to This Policy</h2>
<p>
  We may update this Privacy Policy from time to time. We will notify registered members of
  material changes via email.
</p>

<h2>11. Contact Us</h2>
<p>
  Questions about this Privacy Policy or your personal data? Contact us at
  <a href="mailto:{{support_email}}">{{support_email}}</a>.
</p>`;

/** The two rows every community is seeded with, in the order they are written. */
export const LEGAL_DEFAULT_ROWS: readonly {
  configKey: string;
  configValue: string;
  description: string;
}[] = [
  {
    configKey: 'legal_terms_html',
    configValue: LEGAL_TERMS_DEFAULT_HTML,
    description: 'Terms of Service body copy (rendered on /terms, editable via admin/legal)',
  },
  {
    configKey: 'legal_privacy_html',
    configValue: LEGAL_PRIVACY_DEFAULT_HTML,
    description: 'Privacy Policy body copy (rendered on /privacy, editable via admin/legal)',
  },
];

export interface LegalPlaceholderValues {
  brandName: string;
  legalEntity: string;
  supportEmail: string;
}

// The values come from admin-editable settings and land inside HTML that is
// rendered with innerHTML, so they are escaped rather than trusted. The
// surrounding document is admin-authored and deliberately raw; a name is not.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fills the placeholders in whatever legal copy a community currently has.
 *
 * Applied on the public read rather than at seed time, so a community that
 * renames itself does not keep answering to its old name on two pages nobody
 * re-reads. Copy with no placeholders in it -- anything hand-written -- passes
 * through untouched.
 */
export function fillLegalPlaceholders(html: string, values: LegalPlaceholderValues): string {
  if (!html.includes('{{')) return html;
  return html
    .replace(/\{\{\s*brand_name\s*\}\}/g, escapeHtml(values.brandName))
    .replace(/\{\{\s*legal_entity\s*\}\}/g, escapeHtml(values.legalEntity))
    .replace(/\{\{\s*support_email\s*\}\}/g, escapeHtml(values.supportEmail));
}
