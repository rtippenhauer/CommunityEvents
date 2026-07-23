import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { QuillModule } from 'ngx-quill';
import { AppConfigService, LegalConfigKey } from '../../../core/services/app-config.service';
import { normalizeNbsp } from '../../../shared/utils/normalize-nbsp';

interface LegalTab {
  key: LegalConfigKey;
  label: string;
}

const TABS: LegalTab[] = [
  { key: 'legal_terms_html', label: 'Terms of Service' },
  { key: 'legal_privacy_html', label: 'Privacy Policy' },
  { key: 'about_story_html', label: 'About / Our Story' },
];

@Component({
  selector: 'app-admin-legal',
  standalone: true,
  imports: [
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
        <h1>Legal &amp; Story Copy</h1>
        <p class="subtitle">
          Edit Terms of Service, Privacy Policy, and the home page's "Our Story" copy. Changes
          go live immediately — no deploy needed.
        </p>
      </div>

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
        margin: 0;
        color: #666;
        font-size: 0.9rem;
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
          border-color: var(--db-blue, #1e4d8c);
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
  private readonly snackBar = inject(MatSnackBar);

  readonly tabs = TABS;
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

  readonly form = this.fb.group({
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
