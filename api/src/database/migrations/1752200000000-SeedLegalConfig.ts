import { MigrationInterface, QueryRunner } from 'typeorm';

const TERMS_HTML = `<p class="updated">Last updated: June 2, 2026</p>

<p>
  These Terms of Service ("Terms") govern your use of the DinnerBears platform operated by
  DinnerBears.Com, LLC ("DinnerBears," "we," "us," or "our"). By accessing or using
  DinnerBears, you agree to these Terms.
</p>

<h2>1. Eligibility &amp; Invite-Only Access</h2>
<p>
  DinnerBears is a private, invite-only community. You may only create an account by
  redeeming a valid invite link issued by an existing member or administrator. You must be
  18 years of age or older to use the platform.
</p>

<h2>2. Your Account</h2>
<p>
  You are responsible for maintaining the confidentiality of your account credentials and
  for all activity that occurs under your account. You agree to notify us immediately of any
  unauthorized use of your account at
  <a href="mailto:admin@dinnerbears.com">admin@dinnerbears.com</a>.
</p>

<h2>3. Community Standards</h2>
<p>DinnerBears is a community built on mutual respect. You agree not to:</p>
<ul>
  <li>Share your invite link publicly or with people outside the intended community</li>
  <li>Harass, threaten, or abuse other members</li>
  <li>Post spam, fraudulent, or misleading content</li>
  <li>Attempt to circumvent platform security or access controls</li>
  <li>Use the platform for any unlawful purpose</li>
</ul>

<h2>4. RSVPs and Event Attendance</h2>
<p>
  When you RSVP for a dinner event, your name and RSVP status are visible to other members
  of that city's community. Please cancel your RSVP promptly if you can no longer attend, as
  restaurant reservations are made based on expected attendance.
</p>

<h2>5. Intellectual Property</h2>
<p>
  The DinnerBears platform, including its design, code, and content, is owned by
  DinnerBears.Com, LLC. You may not reproduce, distribute, or create derivative works
  without our express written permission.
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
  DinnerBears is provided "as is" without warranties of any kind. We do not guarantee
  uninterrupted availability of the platform and are not responsible for any restaurant
  experiences, third-party services, or events organized through the platform.
</p>

<h2>8. Limitation of Liability</h2>
<p>
  To the maximum extent permitted by law, DinnerBears.Com, LLC shall not be liable for any
  indirect, incidental, or consequential damages arising from your use of the platform.
</p>

<h2>9. Governing Law</h2>
<p>
  These Terms are governed by the laws of the State of Ohio, United States, without regard
  to conflict of law principles.
</p>

<h2>10. Changes to These Terms</h2>
<p>
  We may update these Terms from time to time. We will notify registered members of material
  changes via email. Continued use of the platform constitutes acceptance of updated Terms.
</p>

<h2>11. Contact</h2>
<p>
  Questions about these Terms? Contact us at
  <a href="mailto:admin@dinnerbears.com">admin@dinnerbears.com</a>
</p>`;

const PRIVACY_HTML = `<p class="updated">Last updated: June 2, 2026</p>

<p>
  DinnerBears.Com, LLC ("DinnerBears," "we," "us," or "our") operates the DinnerBears
  community dining platform at dinnerbears.com and its city subdomains. This Privacy Policy
  explains how we collect, use, and protect your personal information.
</p>

<h2>1. Information We Collect</h2>
<p>We collect the following information when you register and use DinnerBears:</p>
<ul>
  <li><strong>Account information:</strong> Your full name, email address, and city.</li>
  <li>
    <strong>Authentication data:</strong> If you sign in via Google or Facebook OAuth, we
    receive your name, email address, and profile photo from those providers.
  </li>
  <li>
    <strong>Usage data:</strong> Event RSVPs, login history, device type, and IP address for
    security purposes.
  </li>
  <li>
    <strong>Communications:</strong> Any messages or content you submit through the
    platform.
  </li>
</ul>

<h2>2. How We Use Your Information</h2>
<p>We use your information to:</p>
<ul>
  <li>Operate and maintain your DinnerBears account</li>
  <li>Send transactional emails (event reminders, RSVP confirmations, security alerts)</li>
  <li>Display your RSVP status to other members for event planning purposes</li>
  <li>Maintain platform security and prevent abuse</li>
  <li>Comply with legal obligations</li>
</ul>

<h2>3. Information We Do Not Collect</h2>
<p>
  We do not collect payment information, sell your personal data to third parties, or use
  your data for advertising purposes. DinnerBears is a private community platform, not a
  commercial data business.
</p>

<h2>4. Information Sharing</h2>
<p>We do not sell, trade, or share your personal information with third parties except:</p>
<ul>
  <li>
    <strong>Service providers:</strong> We use Brevo and Resend to send transactional emails
    on our behalf.
  </li>
  <li>
    <strong>Legal requirements:</strong> We may disclose information if required by law or
    to protect the rights and safety of our community.
  </li>
</ul>

<h2>5. Facebook and Google Integration</h2>
<p>
  DinnerBears offers optional sign-in via Google and Facebook OAuth. If you use these
  features, those providers' privacy policies also apply. We only request basic profile
  information (name and email) and do not access your social media contacts, posts, or other
  account data.
</p>

<h2>6. Data Retention</h2>
<p>
  We retain your account data for as long as your account is active. If you request account
  deletion, your account is soft-deleted immediately with a 30-day recovery window. After 30
  days, all personally identifiable information is permanently deleted from our systems.
</p>

<h2>7. Security</h2>
<p>
  We implement industry-standard security measures including encrypted passwords, HTTPS,
  secure HTTP-only cookies, and regular security audits. However, no internet transmission
  is completely secure and we cannot guarantee absolute security.
</p>

<h2>8. Your Rights</h2>
<p>You have the right to:</p>
<ul>
  <li>Access the personal information we hold about you</li>
  <li>Correct inaccurate information in your profile</li>
  <li>Request deletion of your account and associated data</li>
  <li>Opt out of non-essential email communications</li>
</ul>

<h2>9. Children's Privacy</h2>
<p>
  DinnerBears is not intended for users under the age of 18. We do not knowingly collect
  personal information from minors.
</p>

<h2>10. Changes to This Policy</h2>
<p>
  We may update this Privacy Policy from time to time. We will notify registered members of
  material changes via email. Continued use of the platform after changes constitutes
  acceptance of the updated policy.
</p>

<h2>11. Contact Us</h2>
<p>
  If you have questions about this Privacy Policy or your personal data, contact us at:
  <a href="mailto:admin@dinnerbears.com">admin@dinnerbears.com</a>
</p>`;

const ABOUT_STORY_HTML = `<span class="section-label">EST. FEBRUARY 2014</span>
<h2 class="story-headline">One simple act.<br />A lifetime of bear memories.</h2>
<p class="story-p">
  On February 22, 2014, Rob Tippenhauer helped his husband Terry Wachtman's old karate
  instructor at a small sushi restaurant in Kentucky. As a thank-you, the instructor
  introduced them both to Chuy's. The very next Tuesday Rob was back — hooked on the free
  queso bar. Terry joined at 7:00 PM after Tai Chi class, and neither of them left. Within
  a few weeks, TJVBear and OhioBear started joining regularly. As the group kept growing,
  Terry found himself spending afternoons each week tracking down who planned to come — so
  Rob created a Facebook event to manage attendance and duplicated it week after week.
</p>
<p class="story-p">
  After nearly two years of Tuesday nights at Chuy's, the group was ready to branch out.
  But the Facebook event format had a frustrating flaw: when someone declined, they were
  dropped from future invites entirely. On February 21, 2016, Rob solved both problems at
  once by creating the
  <em>Cincinnati Tuesday Night Bear Dinners</em> private Facebook Group. The process was
  simple: members nominate restaurants at each dinner, everyone votes, the top vote-getter
  wins, whoever suggested it makes the reservation, and Rob posts the event to the group.
  As the restaurant list grew and the weekly write-ups got more elaborate, managing it
  became a real chore — and members without Facebook were missing out. So in June 2026,
  Rob built DinnerBears.com to take its place. We're actively adding features: sign-in
  with Facebook or Google, +1 RSVPs, and restaurant ratings.
</p>
<blockquote class="story-quote">
  "It's amazing what one simple act of helping someone in a time of need has led to in a
  few short years."
</blockquote>
<div class="story-milestones">
  <div class="milestone">
    <span class="ms-date">Feb 22, 2014</span><span class="ms-text">Rob helps Terry's karate instructor — introduced to Chuy's as a thank-you</span>
  </div>
  <div class="milestone">
    <span class="ms-date">Spring 2014</span><span class="ms-text">TJVBear &amp; OhioBear join; Facebook events created to track weekly attendance</span>
  </div>
  <div class="milestone">
    <span class="ms-date">Sept 1, 2015</span><span class="ms-text">First official Facebook event invite sent to the group</span>
  </div>
  <div class="milestone">
    <span class="ms-date">Feb 21, 2016</span><span class="ms-text">Cincinnati Tuesday Night Bear Dinners Group founded — rotating restaurants &amp; voting begins</span>
  </div>
  <div class="milestone">
    <span class="ms-date">Aug 3, 2016</span><span class="ms-text">First monthly Dayton dinner launched</span>
  </div>
  <div class="milestone">
    <span class="ms-date">June 2026</span><span class="ms-text">DinnerBears.com launches — purpose-built home with Google &amp; Facebook login, +1 RSVPs, and restaurant ratings</span>
  </div>
</div>`;

export class SeedLegalConfig1752200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO app_config (config_key, config_value, description) VALUES
        (?, ?, ?),
        (?, ?, ?),
        (?, ?, ?)`,
      [
        'legal_terms_html',
        TERMS_HTML,
        'Terms of Service body copy (rendered on /terms, editable via admin/legal)',
        'legal_privacy_html',
        PRIVACY_HTML,
        'Privacy Policy body copy (rendered on /privacy, editable via admin/legal)',
        'about_story_html',
        ABOUT_STORY_HTML,
        'Home page "Our Story" narrative + milestone timeline (editable via admin/legal)',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM app_config WHERE config_key IN (?, ?, ?)`,
      ['legal_terms_html', 'legal_privacy_html', 'about_story_html'],
    );
  }
}
