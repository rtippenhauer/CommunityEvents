import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { DemoService } from '../../core/services/demo.service';

/**
 * Asking for a demo community (v2-14).
 *
 * Lives on the root tenant, beside the landing page, because the demo it will
 * create does not have a host until it exists. Signing up is deliberately the
 * same three fields registration takes — what this eventually creates is an
 * ordinary first admin of an ordinary community.
 *
 * The page states the two unusual things up front rather than in the
 * confirmation: the visitor will be an admin, and it disappears in a week. A
 * person who learns about deletion only after entering their group's real
 * events has been misled by omission.
 */
@Component({
  selector: 'app-demo-start',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="demo-page">
      <div class="demo-card">
        @if (sent()) {
          <h1>Check your email</h1>
          <p>
            If a demo was available, there is now a link in your inbox that sets one up. It works
            once, and within 24 hours.
          </p>
          <p class="quiet">
            Nothing has been created yet — following the link is what builds your community.
          </p>
          <a mat-button routerLink="/">Back to {{ brandName() }}</a>
        } @else {
          <h1>Try {{ brandName() }}</h1>
          <p>
            You will get your own community to do anything you like with, as its administrator.
            Nobody else can see it.
          </p>
          <p class="warning">
            <mat-icon>schedule</mat-icon>
            It is deleted a week after you create it, and it cannot send email. Please don't put
            anything in it you would mind losing.
          </p>

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Your name</mat-label>
              <input matInput formControlName="fullName" autocomplete="name" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Email</mat-label>
              <input matInput formControlName="email" type="email" autocomplete="email" />
              <mat-hint>Where the setup link goes. Nothing else is sent to you.</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Choose a password</mat-label>
              <input
                matInput
                formControlName="password"
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="new-password"
              />
              <button
                mat-icon-button
                matSuffix
                type="button"
                (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
              >
                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <mat-hint>You will sign in to your demo with this.</mat-hint>
            </mat-form-field>

            @if (error()) {
              <p class="form-error">{{ error() }}</p>
            }

            <button
              mat-raised-button
              color="primary"
              type="submit"
              class="full-width"
              [disabled]="form.invalid || submitting()"
            >
              @if (submitting()) {
                <mat-spinner diameter="20" />
              } @else {
                Send me a demo
              }
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styleUrl: './demo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoStartComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly demoService = inject(DemoService);
  private readonly brandConfig = inject(BrandConfigService);

  readonly brandName = computed(() => this.brandConfig.brand().name);
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    fullName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit(): void {
    this.error.set(null);
    this.submitting.set(true);
    const { fullName, email, password } = this.form.getRawValue();

    this.demoService.requestDemo(fullName.trim(), email, password).subscribe({
      // The API answers the same way whether it recorded the request, refused
      // it for a cap, or found the address already has a demo — so that the
      // caps cannot be probed from outside. This page must therefore say the
      // same thing too; anything more specific would undo that on the client.
      next: () => {
        this.submitting.set(false);
        this.sent.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err?.status === 429
            ? 'Too many requests just now. Please try again in a minute.'
            : 'Something went wrong. Please try again.',
        );
      },
    });
  }
}
