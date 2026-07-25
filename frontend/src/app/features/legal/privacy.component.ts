import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AppConfigService } from '../../core/services/app-config.service';
import { normalizeNbsp } from '../../shared/utils/normalize-nbsp';

@Component({
  selector: 'app-privacy',
  standalone: true,
  template: `
    <div class="legal-page">
      <div class="legal-content">
        <span class="page-label">Legal</span>
        <h1>Privacy Policy</h1>
        <div class="legal-copy" [innerHTML]="html()"></div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
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
        color: var(--db-primary);
        font-weight: 500;
        margin-bottom: 12px;
      }

      h1 {
        font-size: 2.25rem;
        color: var(--db-brown-dark, #1a2e4a);
        margin: 0 0 8px;
      }

      .legal-copy {
        ::ng-deep .updated {
          font-size: 0.85rem;
          color: #888;
          margin-bottom: 32px;
          padding-bottom: 24px;
          border-bottom: 1px solid rgba(201, 147, 58, 0.2);
        }

        ::ng-deep h2 {
          font-size: 1.15rem;
          color: var(--db-brown-dark, #1a2e4a);
          margin: 2rem 0 0.6rem;
        }

        ::ng-deep p {
          font-size: 0.95rem;
          line-height: 1.8;
          color: #444;
          margin-bottom: 1rem;
        }

        ::ng-deep ul {
          padding-left: 1.5rem;
          margin-bottom: 1rem;

          li {
            font-size: 0.95rem;
            line-height: 1.8;
            color: #444;
            margin-bottom: 0.3rem;
          }
        }

        ::ng-deep a {
          color: var(--db-primary);
        }
      }
    `,
  ],
})
export class PrivacyComponent implements OnInit {
  private readonly appConfigService = inject(AppConfigService);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly content = signal('');

  ngOnInit(): void {
    this.appConfigService.getValue('legal_privacy_html').subscribe({
      next: (value) => this.content.set(value),
      error: () => this.content.set(''),
    });
  }

  html(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.content()));
  }
}
