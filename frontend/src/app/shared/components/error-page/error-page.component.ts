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
         size.

         **The frame is a fixed shape, and that is the point.** It used to be
         min-height: 100vh inside the centred 1280px column, which is not one
         shape but a different one at every window size: 1232x1080 (1.14:1) on
         a 1080p desktop, 328x844 (0.39:1) on a phone. Under cover that meant
         no upload could ever be correct -- the measured page showed 70% of a
         backdrop's height on desktop and 49% of its width on a phone, from the
         same file. So no spec could be written for it, which is why "the image
         is the wrong size" kept coming back however the image was generated.

         aspect-ratio pins it to 8/7, which is the 1600x1400 the brand-image
         prompt asks for (admin/settings/image-prompt.ts -- the two numbers
         are a pair; change one and change the other). A correctly sized upload
         now fits edge to edge with no crop at any width. The max-width keeps it
         a panel rather than a 1078px slab taller than the viewport, and matches
         every other page sitting in a centred column: full-bleed was tried in
         PR #52 and reverted, see that prompt file's SLOTS comment.

         Height still yields to content: the ratio is a preferred height, and
         min-height's default of auto lets the box grow past it when the card
         needs more -- a long message on a narrow phone. **Do not "help" that
         along with min-height: fit-content**, which was tried here and does the
         opposite: it pins the box at the ratio height and lets a 512px card
         overflow a 313px box. Measured, not reasoned about.

         The ratio therefore holds exactly wherever the card fits inside it,
         which is every desktop and tablet width, and relaxes towards square on
         a phone, where the card plus padding is simply taller. The narrow-width
         padding below exists to keep that drift small. */
      .error-bg {
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
        aspect-ratio: 8 / 7;
        background-image:
          radial-gradient(
            ellipse 120% 80% at 50% 0%,
            color-mix(in srgb, var(--ce-primary, #c9933a) 18%, transparent),
            transparent 70%
          );
        background-color: var(--ce-surface, #fdfaf5);
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 48px 16px;
      }

      /* 48px top and bottom is 96px of a phone's ~313px frame, which is what
         pushes the box past its ratio and starts cropping the backdrop
         sideways. Halving it is enough for the card to fit inside the ratio
         again at 390px wide. */
      @media (max-width: 599.98px) {
        .error-bg {
          padding: 24px 12px;
        }
      }

      .error-card {
        background: #fff;
        border-radius: 16px;
        border-top: 4px solid var(--ce-primary, #c9933a);
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
        color: var(--ce-chrome, #3d1c05);
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
        background: color-mix(in srgb, var(--ce-primary, #c9933a) 10%, #fff);
        border: 1px solid color-mix(in srgb, var(--ce-primary, #c9933a) 28%, #fff);
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
        color: var(--ce-chrome, #3d1c05);
        word-break: break-all;
      }

      .invite-hint {
        margin: 0;
        font-size: 0.83rem;
        color: #888;
        background: var(--ce-surface);
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
