import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { DemoService } from '../../core/services/demo.service';

/**
 * Where the confirmation link lands (v2-14).
 *
 * This page is the moment the community is created, which is why it shows work
 * happening rather than redirecting immediately: provisioning seeds members,
 * venues, events, attendance and ratings, so there is a real pause to explain.
 *
 * It does **not** sign the visitor in. The session cookie is host-only (v2-6),
 * so a cookie set here — on the root tenant's host — would not reach the demo's
 * own host. v2-8 built the `oauth_handoffs` ticket for exactly that crossing,
 * but reusing it here would be machinery for a case that does not need it: the
 * visitor chose a password two minutes ago, so the honest answer is to send
 * them to their own community's sign-in page.
 */
@Component({
  selector: 'app-demo-confirm',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="demo-page">
      <div class="demo-card">
        @if (state() === 'working') {
          <h1>Building your demo…</h1>
          <p>Creating your community and filling it with members, venues and events.</p>
          <mat-spinner diameter="32" />
        } @else if (state() === 'ready') {
          <h1>Your demo is ready</h1>
          <p>
            It lives at <strong>{{ host() }}</strong> — sign in there with the email and password
            you chose.
          </p>
          @if (expiresLabel(); as expires) {
            <p class="warning">
              <mat-icon>schedule</mat-icon>
              It is deleted on {{ expires }}, along with everything in it.
            </p>
          }
          <a mat-raised-button color="primary" class="full-width" [href]="url()">
            <mat-icon>open_in_new</mat-icon> Open my demo
          </a>
          <p class="quiet">
            Worth bookmarking — the address is generated, so it is not one you will remember.
          </p>
        } @else {
          <h1>That link didn't work</h1>
          <p>{{ error() }}</p>
          <a mat-button routerLink="/demo">Ask for a new one</a>
        }
      </div>
    </div>
  `,
  styleUrl: './demo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoConfirmComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly demoService = inject(DemoService);
  private readonly brandConfig = inject(BrandConfigService);

  readonly state = signal<'working' | 'ready' | 'failed'>('working');
  readonly url = signal('');
  readonly error = signal('');
  private readonly expiresAt = signal<string | null>(null);

  readonly brandName = computed(() => this.brandConfig.brand().name);

  /** Just the host, since the scheme is noise to a person reading it. */
  readonly host = computed(() => {
    try {
      return new URL(this.url()).host;
    } catch {
      return this.url();
    }
  });

  readonly expiresLabel = computed<string | null>(() => {
    const iso = this.expiresAt();
    if (!iso) return null;
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return null;
    return when.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  });

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('failed');
      this.error.set('That link is missing its token. Check you copied the whole thing.');
      return;
    }

    this.demoService.confirmDemo(token).subscribe({
      next: (res) => {
        this.url.set(res.url);
        this.expiresAt.set(res.expiresAt);
        this.state.set('ready');
      },
      error: (err: { error?: { reason?: string } }) => {
        this.state.set('failed');
        // Each reason gets its own sentence because the remedies differ: a used
        // link means go and look for the demo you already have, an expired one
        // means ask again, and a full pool means come back later. One generic
        // message would send all three to the wrong place.
        const reason = err?.error?.reason;
        if (reason === 'already_confirmed') {
          this.error.set('This link has already been used. Your demo was created the first time.');
        } else if (reason === 'expired') {
          this.error.set('This link has expired. Links last 24 hours.');
        } else if (reason === 'ip_limit') {
          // Distinguished from pool_full deliberately. It leaks nothing at this
          // point -- they hold a valid token, so this is a fact about their own
          // demos, not about the pool -- and the remedy is completely
          // different: wait for your own to expire, not for someone else's.
          this.error.set(
            'You already have the maximum number of demos running. Each one is deleted a week after it is created.',
          );
        } else if (reason === 'pool_full') {
          this.error.set(
            'There are no demo slots free right now. Demos are deleted after a week, so please try again later.',
          );
        } else {
          this.error.set('We could not find that link. Check you copied the whole thing.');
        }
      },
    });
  }
}
