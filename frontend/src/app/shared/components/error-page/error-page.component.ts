import { Component, input, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BrandConfigService } from '../../../core/services/brand-config.service';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="error-bg" [style.background-image]="backdrop()">
      <div class="error-card">
        <mat-icon class="error-icon">{{ icon() }}</mat-icon>
        <h1 class="error-title">{{ title() }}</h1>
        <p class="error-body">{{ body() }}</p>

        @if (invitedEmail()) {
          <div class="invited-email-block">
            <span class="invited-label">Invite sent to:</span>
            <span class="invited-address">{{ invitedEmail() }}</span>
          </div>
        }

        @if (showInviteHint()) {
          <p class="invite-hint">
            Don't have an invite? Ask a current member of
            <strong>{{ brandConfig.brand().name }}</strong> to send you one.
          </p>
        }

        <div class="actions">
          @if (showLoginButton()) {
            <a mat-raised-button color="primary" routerLink="/login">Back to sign in</a>
          }
          @if (showHomeButton()) {
            <a mat-raised-button color="primary" routerLink="/">Go home</a>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      /* Was a fixed DinnerBears menu-board photo (v2-10) — the one branded
         surface with no setting behind it at all, so a member of any community
         met DinnerBears' artwork on every error.

         Two things replaced it. A community can now upload its own backdrop
         (the "error" brand-image slot), which the component binds over
         background-image; and when it has uploaded none, this gradient is what
         shows. The gradient is built from the brand custom properties, so even
         the no-upload case is in that community's own colours —
         BrandConfigService.applyChrome sets them at runtime and styles.scss
         supplies the pre-JS fallbacks, which is what keeps this legible on an
         unresolved tenant that never loaded branding at all.

         The sizing properties below are for the uploaded case; a gradient fills
         its box regardless. Without them an uploaded photo tiles at its natural
         size. */
      .error-bg {
        min-height: 100vh;
        background-image:
          radial-gradient(
            ellipse 120% 80% at 50% 0%,
            color-mix(in srgb, var(--db-primary, #c9933a) 18%, transparent),
            transparent 70%
          );
        background-color: var(--db-cream, #fdfaf5);
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 48px 16px;
      }

      .error-card {
        background: #fff;
        border-radius: 16px;
        border-top: 4px solid var(--db-primary, #c9933a);
        box-shadow: 0 10px 34px rgb(0 0 0 / 9%);
        padding: 36px 28px 32px;
        max-width: 400px;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 14px;
      }

      .error-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: #c62828;
      }

      .error-title {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--db-brown-dark, #3d1c05);
      }

      .error-body {
        margin: 0;
        color: #555;
        line-height: 1.55;
        font-size: 0.95rem;
      }

      .invited-email-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: color-mix(in srgb, var(--db-primary, #c9933a) 10%, #fff);
        border: 1px solid color-mix(in srgb, var(--db-primary, #c9933a) 28%, #fff);
        border-radius: 8px;
        padding: 10px 20px;
        width: 100%;
      }

      .invited-label {
        font-size: 0.72rem;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .invited-address {
        font-weight: 600;
        color: var(--db-brown-dark, #3d1c05);
        word-break: break-all;
      }

      .invite-hint {
        margin: 0;
        font-size: 0.83rem;
        color: #888;
        background: var(--db-cream);
        border-radius: 6px;
        padding: 10px 14px;
        line-height: 1.5;
      }

      .actions {
        margin-top: 4px;
      }
    `,
  ],
})
export class ErrorPageComponent {
  // The invite hint names the community, so this page needs branding. Note it
  // also renders when branding could not load at all (an unresolved tenant),
  // where BrandConfigService keeps DEFAULT_BRAND — hence "CommunityEvents",
  // which is the correct thing to say on a host that belongs to no community.
  readonly brandConfig = inject(BrandConfigService);

  /**
   * The community's uploaded error backdrop, as a CSS background-image value.
   *
   * `null` when nothing is uploaded, which leaves the stylesheet's gradient in
   * place rather than overriding it with an empty url() -- an empty value would
   * paint nothing and lose the fallback entirely. The gradient is deliberately
   * the default: it follows whatever palette the community has configured, so a
   * community that uploads nothing still gets its own colours here.
   */
  readonly backdrop = computed(() => {
    const url = this.brandConfig.errorImageUrl();
    return url ? `url('${encodeURI(url)}')` : null;
  });

  readonly icon = input('error_outline');
  readonly title = input('Something went wrong');
  readonly body = input(
    'Please try again, or contact an admin if the problem continues.',
  );
  readonly showLoginButton = input(false);
  readonly showHomeButton = input(false);
  readonly showInviteHint = input(false);
  readonly invitedEmail = input<string | null>(null);
}
