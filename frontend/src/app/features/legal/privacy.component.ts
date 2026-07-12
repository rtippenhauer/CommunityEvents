import { Component } from '@angular/core';

@Component({
  selector: 'app-privacy',
  standalone: true,
  template: `
    <div class="legal-page">
      <div class="legal-content">
        <span class="page-label">Legal</span>
        <h1>Privacy Policy</h1>
        <p class="updated">Last updated: June 2, 2026</p>

        <p>DinnerBears.Com, LLC ("DinnerBears," "we," "us," or "our") operates the DinnerBears community dining platform at dinnerbears.com and its city subdomains. This Privacy Policy explains how we collect, use, and protect your personal information.</p>

        <h2>1. Information We Collect</h2>
        <p>We collect the following information when you register and use DinnerBears:</p>
        <ul>
          <li><strong>Account information:</strong> Your full name, email address, and city.</li>
          <li><strong>Authentication data:</strong> If you sign in via Google or Facebook OAuth, we receive your name, email address, and profile photo from those providers.</li>
          <li><strong>Usage data:</strong> Event RSVPs, login history, device type, and IP address for security purposes.</li>
          <li><strong>Communications:</strong> Any messages or content you submit through the platform.</li>
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
        <p>We do not collect payment information, sell your personal data to third parties, or use your data for advertising purposes. DinnerBears is a private community platform, not a commercial data business.</p>

        <h2>4. Information Sharing</h2>
        <p>We do not sell, trade, or share your personal information with third parties except:</p>
        <ul>
          <li><strong>Service providers:</strong> We use Brevo and Resend to send transactional emails on our behalf.</li>
          <li><strong>Legal requirements:</strong> We may disclose information if required by law or to protect the rights and safety of our community.</li>
        </ul>

        <h2>5. Facebook and Google Integration</h2>
        <p>DinnerBears offers optional sign-in via Google and Facebook OAuth. If you use these features, those providers' privacy policies also apply. We only request basic profile information (name and email) and do not access your social media contacts, posts, or other account data.</p>

        <h2>6. Data Retention</h2>
        <p>We retain your account data for as long as your account is active. If you request account deletion, your account is soft-deleted immediately with a 30-day recovery window. After 30 days, all personally identifiable information is permanently deleted from our systems.</p>

        <h2>7. Security</h2>
        <p>We implement industry-standard security measures including encrypted passwords, HTTPS, secure HTTP-only cookies, and regular security audits. However, no internet transmission is completely secure and we cannot guarantee absolute security.</p>

        <h2>8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal information we hold about you</li>
          <li>Correct inaccurate information in your profile</li>
          <li>Request deletion of your account and associated data</li>
          <li>Opt out of non-essential email communications</li>
        </ul>

        <h2>9. Children's Privacy</h2>
        <p>DinnerBears is not intended for users under the age of 18. We do not knowingly collect personal information from minors.</p>

        <h2>10. Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. We will notify registered members of material changes via email. Continued use of the platform after changes constitutes acceptance of the updated policy.</p>

        <h2>11. Contact Us</h2>
        <p>If you have questions about this Privacy Policy or your personal data, contact us at: <a href="mailto:admin@dinnerbears.com">admin&#64;dinnerbears.com</a></p>
      </div>
    </div>
  `,
  styles: [`
    .legal-page {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 16px 64px;
    }

    .page-label {
      display: block;
      font-size: 0.75rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--db-gold, #C9933A);
      font-weight: 500;
      margin-bottom: 12px;
    }

    h1 {
      font-size: 2.25rem;
      color: var(--db-brown-dark, #1a2e4a);
      margin: 0 0 8px;
    }

    .updated {
      font-size: 0.85rem;
      color: #888;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid rgba(201, 147, 58, 0.2);
    }

    h2 {
      font-size: 1.15rem;
      color: var(--db-brown-dark, #1a2e4a);
      margin: 2rem 0 0.6rem;
    }

    p {
      font-size: 0.95rem;
      line-height: 1.8;
      color: #444;
      margin-bottom: 1rem;
    }

    ul {
      padding-left: 1.5rem;
      margin-bottom: 1rem;
      li {
        font-size: 0.95rem;
        line-height: 1.8;
        color: #444;
        margin-bottom: 0.3rem;
      }
    }

    a { color: var(--db-gold, #C9933A); }
  `],
})
export class PrivacyComponent {}
