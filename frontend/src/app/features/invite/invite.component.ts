import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

interface Invite {
  id: number;
  boundToEmail: string | null;
  boundToName: string | null;
  token: string;
  expiresAt: string;
  redeemedAt: string | null;
  isRevoked: boolean;
}

@Component({
  selector: 'app-invite',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="invite-page">
      <div class="page-header">
        <mat-icon class="header-icon">group_add</mat-icon>
        <div>
          <h1>Invite a Friend</h1>
          <p class="subtitle">Send a personal invite link — it only works for the email address you specify.</p>
        </div>
      </div>

      <!-- Create form -->
      <div class="invite-card">
        <form [formGroup]="form" (ngSubmit)="create()" class="invite-form">
          <mat-form-field appearance="outline">
            <mat-label>Their Email</mat-label>
            <mat-icon matPrefix>email</mat-icon>
            <input matInput formControlName="boundToEmail" type="email" placeholder="friend@example.com" />
            <mat-hint>The link will only work for this address</mat-hint>
            <mat-error>A valid email is required</mat-error>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Their Name (optional)</mat-label>
            <mat-icon matPrefix>person</mat-icon>
            <input matInput formControlName="boundToName" placeholder="Jane Smith" />
          </mat-form-field>

          <button mat-raised-button color="primary" type="submit" [disabled]="form.invalid || creating()">
            @if (creating()) { <mat-spinner diameter="18" /> }
            @else { <mat-icon>add_link</mat-icon> Generate Invite Link }
          </button>
        </form>

        @if (newInviteUrl()) {
          <div class="new-link-banner">
            <mat-icon class="success-icon">check_circle</mat-icon>
            <div class="link-content">
              <span class="link-label">Invite link created — share it with your friend:</span>
              <span class="link-url">{{ newInviteUrl() }}</span>
            </div>
            <button mat-icon-button (click)="copyNew()" matTooltip="Copy link">
              <mat-icon>content_copy</mat-icon>
            </button>
          </div>
        }
      </div>

      <!-- Invite history -->
      @if (invites().length > 0) {
        <div class="history-card">
          <h2>Your Invites</h2>
          <div class="invite-list">
            @for (invite of invites(); track invite.id) {
              <div class="invite-row">
                <div class="invite-info">
                  <span class="invite-email">{{ invite.boundToEmail ?? '—' }}</span>
                  @if (invite.boundToName) {
                    <span class="invite-name">{{ invite.boundToName }}</span>
                  }
                  <span class="invite-meta">Expires {{ invite.expiresAt | date:'shortDate' }}</span>
                </div>
                <div class="invite-actions">
                  @if (invite.isRevoked) {
                    <mat-chip class="chip-revoked">Revoked</mat-chip>
                  } @else if (invite.redeemedAt) {
                    <mat-chip class="chip-used">Joined!</mat-chip>
                  } @else if (isExpired(invite)) {
                    <mat-chip class="chip-expired">Expired</mat-chip>
                  } @else {
                    <mat-chip class="chip-active">Pending</mat-chip>
                    <button mat-icon-button matTooltip="Copy invite link" (click)="copyToken(invite.token)">
                      <mat-icon>content_copy</mat-icon>
                    </button>
                    <button mat-icon-button matTooltip="Revoke invite" class="revoke-btn"
                      [disabled]="revokingId() === invite.id"
                      (click)="revoke(invite.id)">
                      @if (revokingId() === invite.id) { <mat-spinner diameter="16" /> }
                      @else { <mat-icon>link_off</mat-icon> }
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .invite-page { max-width: 600px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 20px; }

    .page-header {
      display: flex; align-items: flex-start; gap: 14px;
      h1 { margin: 0 0 4px; font-size: 1.75rem; color: var(--db-brown-dark); }
      .header-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; color: var(--db-blue, #1E4D8C); margin-top: 4px; flex-shrink: 0; }
    }
    .subtitle { margin: 0; font-size: 0.9rem; color: #666; }

    .invite-card, .history-card {
      background: white; border-radius: 12px; padding: 24px;
      box-shadow: 0 2px 8px rgba(61,28,5,0.07);
    }

    .invite-form { display: flex; flex-direction: column; gap: 16px; mat-form-field { width: 100%; } }

    .new-link-banner {
      display: flex; align-items: flex-start; gap: 12px; margin-top: 20px;
      background: #e8f5e9; border-radius: 10px; padding: 14px 16px;
      .success-icon { color: #2e7d32; flex-shrink: 0; margin-top: 2px; }
      .link-content { flex: 1; min-width: 0; }
      .link-label { display: block; font-size: 0.8rem; color: #388e3c; font-weight: 600; margin-bottom: 4px; }
      .link-url { display: block; font-size: 0.8rem; color: #333; word-break: break-all; }
    }

    .history-card h2 { margin: 0 0 16px; font-size: 1.05rem; color: #444; }
    .invite-list { display: flex; flex-direction: column; gap: 0; }
    .invite-row {
      display: flex; align-items: center; gap: 12px; padding: 12px 0;
      border-bottom: 1px solid #f0f0f0;
      &:last-child { border-bottom: none; }
    }
    .invite-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .invite-email { font-size: 0.9rem; font-weight: 600; color: #222; }
    .invite-name { font-size: 0.8rem; color: #666; }
    .invite-meta { font-size: 0.75rem; color: #aaa; }
    .invite-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

    mat-chip { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; min-height: unset; }
    .chip-active { background: #e3f2fd; color: #1565c0; }
    .chip-used { background: #e8f5e9; color: #2e7d32; }
    .chip-expired { background: #f5f5f5; color: #999; }
    .chip-revoked { background: #fce4ec; color: #c62828; }
    .revoke-btn mat-icon { color: #ef9a9a; }
  `],
})
export class InviteComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly invites = signal<Invite[]>([]);
  readonly creating = signal(false);
  readonly revokingId = signal<number | null>(null);
  readonly newInviteUrl = signal<string | null>(null);

  readonly form = this.fb.group({
    boundToEmail: ['', [Validators.required, Validators.email]],
    boundToName: [''],
  });

  ngOnInit(): void {
    this.http.get<Invite[]>('/api/v1/invites/mine').subscribe({
      next: (invites) => this.invites.set(invites),
      error: () => {},
    });
  }

  create(): void {
    if (this.form.invalid) return;
    this.creating.set(true);
    const { boundToEmail, boundToName } = this.form.getRawValue();
    const body: Record<string, string> = { type: 'member', boundToEmail };
    if (boundToName.trim()) body['boundToName'] = boundToName.trim();

    this.http.post<Invite>('/api/v1/invites', body).subscribe({
      next: (invite) => {
        this.newInviteUrl.set(`${window.location.origin}/login?token=${invite.token}`);
        this.invites.update((list) => [invite, ...list]);
        this.form.reset();
        this.creating.set(false);
      },
      error: (err) => {
        this.creating.set(false);
        const msg = err?.error?.message;
        if (msg === 'already_a_member') {
          this.snackBar.open('This person is already a DinnerBears member.', 'OK', { duration: 5000 });
        } else if (msg === 'invite_already_exists') {
          this.snackBar.open('An invite was already sent to this email and is still active.', 'OK', { duration: 5000 });
        } else {
          this.snackBar.open(msg ?? 'Failed to create invite', 'OK', { duration: 4000 });
        }
      },
    });
  }

  revoke(id: number): void {
    this.revokingId.set(id);
    this.http.patch(`/api/v1/invites/${id}/revoke-own`, {}).subscribe({
      next: () => {
        this.invites.update((list) => list.map((i) => i.id === id ? { ...i, isRevoked: true } : i));
        this.revokingId.set(null);
      },
      error: () => {
        this.revokingId.set(null);
        this.snackBar.open('Failed to revoke invite', 'OK', { duration: 3000 });
      },
    });
  }

  copyToken(token: string): void {
    void navigator.clipboard.writeText(`${window.location.origin}/login?token=${token}`);
    this.snackBar.open('Link copied!', undefined, { duration: 2000 });
  }

  copyNew(): void {
    const url = this.newInviteUrl();
    if (url) {
      void navigator.clipboard.writeText(url);
      this.snackBar.open('Link copied!', undefined, { duration: 2000 });
    }
  }

  isExpired(invite: Invite): boolean {
    return new Date(invite.expiresAt) < new Date();
  }
}
