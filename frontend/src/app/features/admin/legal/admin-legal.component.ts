import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { QuillModule } from 'ngx-quill';
import { AppConfigService, LegalConfigKey } from '../../../core/services/app-config.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { normalizeNbsp } from '../../../shared/utils/normalize-nbsp';

interface LegalTab {
  key: LegalConfigKey;
  label: string;
}

const TABS: LegalTab[] = [
  { key: 'home_hero_html', label: 'Home Hero' },
  { key: 'home_howitworks_html', label: 'How It Works' },
  { key: 'legal_terms_html', label: 'Terms of Service' },
  { key: 'legal_privacy_html', label: 'Privacy Policy' },
  { key: 'about_story_html', label: 'About / Our Story' },
];

@Component({
  selector: 'app-admin-legal',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    QuillModule,
  ],
  template: `
    <div class="legal-admin-page">
      <div class="page-header">
        <h1>Content &amp; Legal Copy</h1>
        <p class="subtitle">
          Edit the home-page hero, Terms of Service, Privacy Policy, and the home page's "Our
          Story" copy. Changes go live immediately — no deploy needed.
        </p>
        <p class="subtitle">
          Terms and Privacy support
          @for (name of placeholders; track name) {
            <code>{{ name }}</code>@if (!$last) {<span>, </span>}
          }
          — filled in when the page is served, so renaming this community does not strand its
          old name inside two documents.
        </p>
      </div>

      @if (!loading()) {
        <div class="review-callout" [class.reviewed]="reviewedAt()">
          @if (reviewedAt()) {
            <span>
              Terms and Privacy Policy confirmed {{ reviewedAt() | date: 'MMM d, y' }}. Confirm
              again after any material change.
            </span>
          } @else {
            <span>
              This community's Terms and Privacy Policy are the starter copy it was created
              with. Read both, edit anything that is wrong for you, then confirm — the banner
              at the top of the site stays up until you do.
            </span>
          }
          <button
            mat-stroked-button
            type="button"
            [disabled]="markingReviewed()"
            (click)="markReviewed()"
          >
            @if (markingReviewed()) {
              <mat-spinner diameter="18" />
            } @else {
              {{ reviewedAt() ? 'Confirm again' : 'Mark as reviewed' }}
            }
          </button>
        </div>
      }

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else {
        <mat-tab-group>
          @for (tab of tabs; track tab.key) {
            <mat-tab [label]="tab.label">
              <div class="tab-body">
                <div class="quill-wrapper">
                  <quill-editor
                    [formControl]="form.controls[tab.key]"
                    [modules]="quillModules"
                    class="legal-quill"
                  ></quill-editor>
                </div>
                <div class="tab-actions">
                  <button
                    mat-raised-button
                    color="primary"
                    type="button"
                    [disabled]="saving() === tab.key"
                    (click)="save(tab.key)"
                  >
                    @if (saving() === tab.key) {
                      <mat-spinner diameter="18" />
                    } @else {
                      Save
                    }
                  </button>
                </div>
              </div>
            </mat-tab>
          }
        </mat-tab-group>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .legal-admin-page {
        max-width: 900px;
        margin: 0 auto;
        padding: 24px 16px;
      }
      .page-header {
        margin-bottom: 20px;
        h1 {
          margin: 0 0 6px;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .subtitle {
        margin: 0 0 6px;
        color: #666;
        font-size: 0.9rem;

        code {
          font-size: 0.85em;
          background: rgba(0, 0, 0, 0.05);
          padding: 1px 4px;
          border-radius: 3px;
        }
      }
      .review-callout {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        justify-content: space-between;
        background: #fdf3d8;
        border: 1px solid #e6d3a3;
        color: #6b4e12;
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 16px;
        font-size: 0.85rem;

        span {
          flex: 1 1 320px;
        }

        &.reviewed {
          background: #eef6ec;
          border-color: #cfe3ca;
          color: #38603a;
        }
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 60px 0;
      }
      .tab-body {
        padding: 20px 4px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .quill-wrapper {
        border: 1px solid rgba(0, 0, 0, 0.23);
        border-radius: 4px;
        &:focus-within {
          border-color: var(--db-primary);
          border-width: 2px;
        }
      }
      .legal-quill {
        display: block;
      }
      ::ng-deep .legal-quill .ql-container {
        border: none;
        min-height: 320px;
        font-size: 0.95rem;
      }
      ::ng-deep .legal-quill .ql-toolbar {
        border: none;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }
      .tab-actions {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class AdminLegalComponent implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly appConfigService = inject(AppConfigService);
  private readonly brandConfig = inject(BrandConfigService);
  private readonly snackBar = inject(MatSnackBar);

  readonly tabs = TABS;
  // Written as data rather than in the template: Angular decodes HTML entities
  // before parsing interpolation, so a literal {{...}} cannot be escaped there.
  readonly placeholders = ['{{brand_name}}', '{{legal_entity}}', '{{support_email}}'];
  readonly loading = signal(true);
  readonly saving = signal<LegalConfigKey | null>(null);

  readonly quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ header: [2, 3, false] }],
      ['link'],
      ['clean'],
    ],
  };

  /** Empty until this community confirms its legal copy; see app.component's banner. */
  readonly reviewedAt = signal<string>('');
  readonly markingReviewed = signal(false);

  readonly form = this.fb.group({
    home_hero_html: [''],
    home_howitworks_html: [''],
    legal_terms_html: [''],
    legal_privacy_html: [''],
    about_story_html: [''],
  });

  ngOnInit(): void {
    this.appConfigService.getLegalConfig().subscribe({
      next: (items) => {
        const values = Object.fromEntries(items.map((i) => [i.configKey, i.configValue])) as Record<
          LegalConfigKey,
          string
        >;
        this.form.setValue({
          home_hero_html: values.home_hero_html ?? '',
          home_howitworks_html: values.home_howitworks_html ?? '',
          legal_terms_html: values.legal_terms_html ?? '',
          legal_privacy_html: values.legal_privacy_html ?? '',
          about_story_html: values.about_story_html ?? '',
        });
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Failed to load legal copy', 'OK', { duration: 4000 });
      },
    });

    // Separate request because the review flag is a site setting, not legal
    // copy -- it says something about the copy rather than being part of it.
    // A failure here leaves the callout in its unreviewed state, which is the
    // safe way round.
    this.appConfigService.getSiteSettings().subscribe({
      next: (settings) => {
        this.reviewedAt.set(
          settings.find((s) => s.configKey === 'legal_reviewed_at')?.configValue ?? '',
        );
      },
      error: () => {},
    });
  }

  /**
   * Records that a human has read this community's Terms and Privacy Policy.
   *
   * Refreshes branding afterwards because the site-wide banner reads
   * `legalReviewed` off that payload, which was fetched at app start -- without
   * this the banner would stay up until the next full page load.
   */
  markReviewed(): void {
    this.markingReviewed.set(true);
    const now = new Date().toISOString();
    this.appConfigService.updateValue('legal_reviewed_at', now).subscribe({
      next: () => {
        this.reviewedAt.set(now);
        this.markingReviewed.set(false);
        void this.brandConfig.refresh();
        this.snackBar.open('Legal copy confirmed', 'OK', { duration: 2500 });
      },
      error: () => {
        this.markingReviewed.set(false);
        this.snackBar.open('Failed to save', 'OK', { duration: 4000 });
      },
    });
  }

  save(key: LegalConfigKey): void {
    this.saving.set(key);
    const value = normalizeNbsp(this.form.controls[key].value);
    this.appConfigService.updateValue(key, value).subscribe({
      next: () => {
        this.saving.set(null);
        this.snackBar.open('Saved', 'OK', { duration: 2500 });
      },
      error: () => {
        this.saving.set(null);
        this.snackBar.open('Failed to save', 'OK', { duration: 4000 });
      },
    });
  }
}
