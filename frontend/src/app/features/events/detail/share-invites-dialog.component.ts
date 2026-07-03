import { Component, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, EventsService } from '../../../core/services/events.service';
import { EventInviteLink, InvitesService } from '../../../core/services/invites.service';

export interface ShareInvitesDialogData {
  event: Event;
  isAdmin: boolean;
}

@Component({
  selector: 'app-share-invites-dialog',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title><mat-icon>share</mat-icon> Share &amp; Invite Links</h2>
    <mat-dialog-content>
      <div class="share-btn-row">
        <button mat-stroked-button class="fb-btn" (click)="shareToFacebook()"
          matTooltip="Opens Facebook share dialog — change destination to your DinnerBears group">
          <mat-icon>open_in_new</mat-icon> Share on Facebook
        </button>
        <button mat-stroked-button (click)="copyPostText()"
          [matTooltip]="activeNvLink() ? 'Copies post text with Guest Member invite link included' : 'Copies post text'">
          <mat-icon>content_copy</mat-icon> Copy Post Text
        </button>
      </div>

      @if (!inviteLinksLoading() && (activeNvLink() || activeMemberLink())) {
        <mat-divider class="share-divider" />
        <div class="share-quick-links">
          <div class="share-ql-label">Quick Copy Invite Links</div>
          @if (activeNvLink()) {
            <div class="share-ql-row">
              <span class="link-flavor-badge flavor-nv">Guest Member</span>
              <span class="share-ql-url">{{ origin }}/join/{{ activeNvLink()!.token }}</span>
              <button mat-icon-button matTooltip="Copy link" (click)="copyInviteLink(activeNvLink()!.token)">
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
          }
          @if (activeMemberLink()) {
            <div class="share-ql-row">
              <span class="link-flavor-badge flavor-member">Full Member</span>
              <span class="share-ql-url">{{ origin }}/join/{{ activeMemberLink()!.token }}</span>
              <button mat-icon-button matTooltip="Copy link" (click)="copyInviteLink(activeMemberLink()!.token)">
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
          }
        </div>
      }

      <mat-divider class="share-divider" />

      <div class="invite-links-header">
        <h4 class="invite-links-title">
          <mat-icon>link</mat-icon> Event Invite Links
        </h4>
        @if (data.isAdmin) {
          <button mat-stroked-button class="new-link-btn" (click)="showNewLinkForm.set(!showNewLinkForm())">
            <mat-icon>add</mat-icon> New Link
          </button>
        }
      </div>

      @if (showNewLinkForm()) {
        <div class="new-link-form">
          <mat-button-toggle-group [value]="newLinkFlavor()" (change)="newLinkFlavor.set($event.value)" class="flavor-toggle">
            <mat-button-toggle value="non_validated">Guest Member</mat-button-toggle>
            <mat-button-toggle value="member">Full Member</mat-button-toggle>
          </mat-button-toggle-group>
          <mat-form-field appearance="outline" class="link-field">
            <mat-label>Max Uses (blank = unlimited)</mat-label>
            <input matInput type="number" [formControl]="newLinkMaxUsesCtrl" min="1" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="link-field">
            <mat-label>Expires in (days)</mat-label>
            <input matInput type="number" [formControl]="newLinkExpiryCtrl" min="1" max="90" />
          </mat-form-field>
          <button mat-raised-button color="primary" (click)="createInviteLink()" [disabled]="creatingLink()">
            @if (creatingLink()) { <mat-spinner diameter="16" /> }
            Generate Link
          </button>
        </div>
      }

      @if (inviteLinksLoading()) {
        <div class="links-spinner"><mat-spinner diameter="24" /></div>
      } @else if (inviteLinks().length === 0) {
        <p class="no-links">No invite links yet.</p>
      } @else {
        <div class="invite-links-list">
          @for (link of inviteLinks(); track link.id) {
            <div class="invite-link-row" [class.link-revoked]="link.isRevoked">
              <div class="link-info">
                <span class="link-flavor-badge" [class.flavor-member]="link.inviteFlavor === 'member'" [class.flavor-nv]="link.inviteFlavor === 'non_validated'">
                  {{ link.inviteFlavor === 'member' ? 'Member' : 'Guest Member' }}
                </span>
                <span class="link-uses">{{ link.useCount }}{{ link.maxUses ? '/' + link.maxUses : '' }} uses</span>
                <span class="link-expiry">exp. {{ link.expiresAt | date: 'MMM d' }}</span>
                @if (link.isRevoked) {
                  <span class="link-revoked-badge">Revoked</span>
                }
              </div>
              <div class="link-actions">
                @if (!link.isRevoked) {
                  <button mat-icon-button matTooltip="Copy link" (click)="copyInviteLink(link.token)">
                    <mat-icon>content_copy</mat-icon>
                  </button>
                  @if (data.isAdmin) {
                    <button mat-icon-button matTooltip="Revoke" color="warn" (click)="revokeInviteLink(link.id)">
                      <mat-icon>block</mat-icon>
                    </button>
                  }
                }
              </div>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 320px; }
    .share-btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
    .share-divider { margin: 16px 0; }
    .share-quick-links { display: flex; flex-direction: column; gap: 6px; }
    .share-ql-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin-bottom: 2px; }
    .share-ql-row { display: flex; align-items: center; gap: 8px; }
    .share-ql-url { flex: 1; font-size: 0.82rem; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .invite-links-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .invite-links-title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 1rem; color: var(--db-brown-dark); mat-icon { color: #C9933A; } }
    .new-link-btn { font-size: 0.8rem; height: 32px !important; }

    .new-link-form {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 12px;
      margin-bottom: 12px;
      background: #faf7f2;
      border-radius: 8px;
    }
    .flavor-toggle { height: 36px; }
    .link-field { width: 170px; }

    .links-spinner { display: flex; justify-content: center; padding: 16px; }
    .no-links { color: #999; font-size: 0.88rem; margin: 0; }

    .invite-links-list { display: flex; flex-direction: column; gap: 8px; }
    .invite-link-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border: 1px solid #e8e0d6;
      border-radius: 8px;
      &.link-revoked { opacity: 0.55; }
    }
    .link-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.82rem; color: #666; }
    .link-flavor-badge {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 2px 8px;
      border-radius: 10px;
      background: #eee;
      color: #666;
      &.flavor-nv { background: #fff3e0; color: #b8832e; }
      &.flavor-member { background: #e3f2fd; color: #1565c0; }
    }
    .link-revoked-badge { font-size: 0.7rem; font-weight: 700; color: #c62828; }
    .link-actions { display: flex; align-items: center; }
  `],
})
export class ShareInvitesDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ShareInvitesDialogComponent>);
  private readonly eventsService = inject(EventsService);
  private readonly invitesService = inject(InvitesService);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<ShareInvitesDialogData>(MAT_DIALOG_DATA);

  readonly origin = window.location.origin;

  readonly inviteLinks = signal<EventInviteLink[]>([]);
  readonly inviteLinksLoading = signal(false);
  readonly showNewLinkForm = signal(false);
  readonly newLinkFlavor = signal<'member' | 'non_validated'>('non_validated');
  readonly newLinkMaxUsesCtrl = new FormControl<number | null>(null);
  readonly newLinkExpiryCtrl = new FormControl<number>(30, { nonNullable: true });
  readonly creatingLink = signal(false);

  readonly activeNvLink = computed(() =>
    this.inviteLinks().find(l => l.inviteFlavor === 'non_validated' && !l.isRevoked) ?? null
  );

  readonly activeMemberLink = computed(() =>
    this.inviteLinks().find(l => l.inviteFlavor === 'member' && !l.isRevoked) ?? null
  );

  constructor() {
    this.loadInviteLinks();
  }

  private loadInviteLinks(): void {
    this.inviteLinksLoading.set(true);
    this.invitesService.getEventInviteLinks(this.data.event.id).subscribe({
      next: (links) => {
        this.inviteLinks.set(links);
        this.inviteLinksLoading.set(false);
      },
      error: () => this.inviteLinksLoading.set(false),
    });
  }

  shareToFacebook(): void {
    const e = this.data.event;
    const url = `${window.location.origin}/events/${e.id}`;
    const quote = this.eventsService.generatePostText(e);
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(quote)}`,
      '_blank',
      'noopener',
    );
  }

  copyPostText(): void {
    const nvLink = this.activeNvLink();
    const nvUrl = nvLink ? `${window.location.origin}/join/${nvLink.token}` : undefined;
    const text = this.eventsService.generatePostText(this.data.event, nvUrl);
    this.clipboard.copy(text);
    this.snackBar.open('Post text copied!', 'OK', { duration: 3000 });
  }

  copyInviteLink(token: string): void {
    const url = `${window.location.origin}/join/${token}`;
    this.clipboard.copy(url);
    this.snackBar.open('Invite link copied!', 'OK', { duration: 2000 });
  }

  createInviteLink(): void {
    this.creatingLink.set(true);
    this.invitesService.createEventInviteLink(this.data.event.id, {
      flavor: this.newLinkFlavor(),
      maxUses: this.newLinkMaxUsesCtrl.value ?? null,
      expiryDays: this.newLinkExpiryCtrl.value,
    }).subscribe({
      next: (link) => {
        this.inviteLinks.update((links) => [link, ...links]);
        this.showNewLinkForm.set(false);
        this.creatingLink.set(false);
        const url = `${window.location.origin}/join/${link.token}`;
        this.clipboard.copy(url);
        this.snackBar.open('Invite link created and copied!', 'OK', { duration: 3000 });
      },
      error: () => {
        this.creatingLink.set(false);
        this.snackBar.open('Failed to create invite link', 'OK', { duration: 3000 });
      },
    });
  }

  revokeInviteLink(inviteId: number): void {
    if (!window.confirm('Revoke this invite link? Any unactivated links will stop working.')) return;
    this.invitesService.revokeEventInviteLink(this.data.event.id, inviteId).subscribe({
      next: () => {
        this.inviteLinks.update((links) => links.map((l) => l.id === inviteId ? { ...l, isRevoked: true } : l));
        this.snackBar.open('Invite link revoked', 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Failed to revoke link', 'OK', { duration: 3000 }),
    });
  }
}
