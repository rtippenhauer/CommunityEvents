import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReleasesService, Release } from '../../core/services/releases.service';
import { AuthService } from '../../core/services/auth.service';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { normalizeNbsp } from '../../shared/utils/normalize-nbsp';

@Component({
  selector: 'app-updates',
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="updates-page">
      <div class="page-header">
        <div>
          <h1>Release Notes</h1>
          <p class="subtitle">What's new.</p>
        </div>
        @if (!isNonValidated()) {
          <button mat-stroked-button routerLink="/feedback">
            <mat-icon>feedback</mat-icon> Give Feedback
          </button>
        }
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else if (releases().length === 0) {
        <div class="empty-state">
          <mat-icon>rocket_launch</mat-icon>
          <p>No releases yet — check back soon.</p>
        </div>
      } @else {
        <div class="releases-list">
          @for (release of releases(); track release.id) {
            <article class="release-card">
              <div class="release-version-row">
                <span class="version-badge">{{ versionLabel(release) }}</span>
                <span class="release-date">{{ release.publishedAt | date: 'MMMM d, y' }}</span>
              </div>
              <h2 class="release-title">{{ release.title }}</h2>
              <div class="release-body" [innerHTML]="safeHtml(release.body)"></div>

              @if (hasCredits(release)) {
                <div class="community-credit">
                  <mat-icon class="credit-icon">people</mat-icon>
                  <span>
                    Thanks to {{ creditList(release) }} for the feedback that made this possible.
                  </span>
                </div>
              }
            </article>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .updates-page {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 16px;
      }

      .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 32px;
        h1 {
          margin: 0 0 4px;
          font-size: 1.75rem;
          color: var(--ce-chrome);
        }
      }
      .subtitle {
        margin: 0;
        font-size: 0.9rem;
        color: #666;
      }

      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty-state {
        text-align: center;
        padding: 48px 0;
        mat-icon {
          font-size: 3rem;
          width: 3rem;
          height: 3rem;
          color: #ccc;
          margin-bottom: 12px;
        }
        p {
          color: #999;
          margin: 0;
        }
      }

      .releases-list {
        display: flex;
        flex-direction: column;
        gap: 32px;
      }

      .release-card {
        background: white;
        border-radius: 12px;
        padding: 28px;
        box-shadow: 0 2px 8px rgba(61, 28, 5, 0.07);
        border-left: 4px solid var(--ce-primary);
        overflow-wrap: break-word;
        min-width: 0;
      }

      .release-version-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }
      .version-badge {
        font-size: 0.78rem;
        font-weight: 800;
        padding: 3px 10px;
        border-radius: 12px;
        background: var(--ce-primary);
        color: var(--ce-on-primary);
        letter-spacing: 0.05em;
      }
      .release-date {
        font-size: 0.82rem;
        color: #aaa;
      }

      .release-title {
        margin: 0 0 16px;
        font-size: 1.25rem;
        color: var(--ce-chrome);
      }

      .release-body {
        font-size: 0.95rem;
        line-height: 1.7;
        color: #333;
        overflow-wrap: break-word;
        word-break: normal;
        hyphens: none;
        min-width: 0;
        ::ng-deep p {
          margin: 0 0 10px;
          &:last-child {
            margin-bottom: 0;
          }
        }
        ::ng-deep ul,
        ::ng-deep ol {
          padding-left: 20px;
          margin: 0 0 10px;
        }
        ::ng-deep h2,
        ::ng-deep h3 {
          margin: 16px 0 8px;
          color: var(--ce-chrome);
        }
      }

      .community-credit {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 16px;
        padding: 10px 14px;
        background: #f3f8ff;
        border-radius: 8px;
        font-size: 0.85rem;
        color: #555;
        .credit-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          color: var(--ce-primary);
          flex-shrink: 0;
          margin-top: 1px;
        }
      }
    `,
  ],
})
export class UpdatesComponent implements OnInit {
  private readonly releasesService = inject(ReleasesService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly authService = inject(AuthService);
  private readonly brandConfig = inject(BrandConfigService);

  isNonValidated(): boolean {
    return this.authService.isNonValidated();
  }

  readonly loading = signal(true);
  readonly releases = signal<Release[]>([]);

  ngOnInit(): void {
    this.releasesService.getPublished().subscribe({
      next: (data) => {
        this.releases.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  safeHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.substituteTerms(content)));
  }

  versionLabel(release: Release): string {
    return /^\d/.test(release.version) ? `v${release.version}` : release.version;
  }

  // Shared release notes (see docs/RELEASE_NOTE_PIPELINE_SPEC.md) ship with
  // {{points}}/{{locations}}/{{events}} placeholder tokens instead of
  // hardcoded wording, so one note reads correctly on every fork's own
  // terminology. Instance-specific notes never contain these tokens, so this
  // is a no-op for them.
  private substituteTerms(content: string): string {
    return content
      .replace(/\{\{\s*points\s*\}\}/gi, this.brandConfig.points())
      .replace(/\{\{\s*locations\s*\}\}/gi, this.brandConfig.locationPluralLower())
      .replace(/\{\{\s*events\s*\}\}/gi, this.brandConfig.dinnerPluralLower());
  }

  /**
   * Whether this release has anybody to thank — which is no longer the same
   * question as whether it has feedback *this* community can see. A release
   * shipped on another community's report has an anonymous credit and no
   * visible ticket, and it still earned a thanks line (Rob, 2026-10-03).
   */
  hasCredits(release: Release): boolean {
    return (release.linkedFeedback ?? []).length > 0 || (release.anonymousCredits ?? 0) > 0;
  }

  /**
   * The thanks line.
   *
   * Three kinds of contributor collapse into two phrasings. A member of this
   * community who did not mark their ticket private is named. A member of this
   * community who did, and a member of any other community, both become "a
   * community member" — the first because they asked for privacy, the second
   * because their name belongs to their own community's copy of this note,
   * where they are named in full.
   */
  creditList(release: Release): string {
    const named = [
      ...new Set(
        (release.linkedFeedback ?? [])
          .filter((fb) => !fb.isPrivate && fb.user?.fullName)
          .map((fb) => fb.user!.fullName),
      ),
    ];

    const anonymous =
      (release.linkedFeedback ?? []).filter((fb) => fb.isPrivate || !fb.user?.fullName).length +
      (release.anonymousCredits ?? 0);

    const parts = [...named];
    // Collapsed to one phrase rather than repeated: "a community member and a
    // community member" names the same unknown twice.
    if (anonymous === 1) parts.push('a community member');
    else if (anonymous > 1) parts.push(`${anonymous} community members`);

    if (parts.length === 0) return 'a community member';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  }
}
