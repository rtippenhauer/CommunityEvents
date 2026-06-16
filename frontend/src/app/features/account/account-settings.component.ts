import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AccountService, ConnectedProviders } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="settings-page">
      <h1 class="page-title">Account Settings</h1>

      <!-- Connected Accounts -->
      <mat-card class="settings-card">
        <mat-card-header>
          <mat-card-title>Connected Accounts</mat-card-title>
          <mat-card-subtitle>Manage how you log in to DinnerBears</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (loading()) {
            <div class="loading-row"><mat-spinner diameter="28"></mat-spinner></div>
          } @else if (providers()) {
            <!-- Google -->
            <div class="provider-row">
              <div class="provider-info">
                <img src="/assets/icons/google.svg" alt="Google" class="provider-icon" />
                <div class="provider-text">
                  <span class="provider-name">Google</span>
                  @if (providers()!.google) {
                    <span class="provider-email">{{ providers()!.google!.email }}</span>
                  } @else {
                    <span class="provider-email not-connected">Not connected</span>
                  }
                </div>
              </div>
              @if (providers()!.google) {
                @if (providers()!.hasMultipleMethods) {
                  <button mat-stroked-button color="warn" (click)="confirmDisconnect('google')" [disabled]="disconnecting()">
                    Disconnect
                  </button>
                } @else {
                  <span class="only-method-label">Only login method</span>
                }
              }
            </div>

            <mat-divider></mat-divider>

            <!-- Facebook -->
            <div class="provider-row">
              <div class="provider-info">
                <img src="/assets/icons/facebook.svg" alt="Facebook" class="provider-icon" />
                <div class="provider-text">
                  <span class="provider-name">Facebook</span>
                  @if (providers()!.facebook) {
                    <span class="provider-email">{{ providers()!.facebook!.email ?? 'Connected' }}</span>
                  } @else {
                    <span class="provider-email not-connected">Not connected</span>
                  }
                </div>
              </div>
              @if (providers()!.facebook) {
                @if (providers()!.hasMultipleMethods) {
                  <button mat-stroked-button color="warn" (click)="confirmDisconnect('facebook')" [disabled]="disconnecting()">
                    Disconnect
                  </button>
                } @else {
                  <span class="only-method-label">Only login method</span>
                }
              }
            </div>

            <mat-divider></mat-divider>

            <!-- Email/Password — stub for Phase 11 -->
            <div class="provider-row">
              <div class="provider-info">
                <mat-icon class="provider-icon-mat">email</mat-icon>
                <div class="provider-text">
                  <span class="provider-name">Email / Password</span>
                  <span class="provider-email not-connected">Available in a future update</span>
                </div>
              </div>
            </div>
          }
        </mat-card-content>
      </mat-card>

      <!-- Danger Zone -->
      @if (currentUser()?.role !== 'admin') {
        <mat-card class="settings-card danger-zone-card">
          <mat-card-header>
            <mat-card-title class="danger-title">Danger Zone</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="danger-description">
              Permanently delete your DinnerBears account and all associated login credentials.
              Your name and email will be deleted within 30 days.
            </p>
            <button mat-raised-button color="warn" (click)="startDeleteFlow()" [disabled]="deleting()">
              <mat-icon>delete_forever</mat-icon>
              Delete My Account
            </button>
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-card class="settings-card">
          <mat-card-content>
            <p class="admin-note">
              <mat-icon>info</mat-icon>
              Admin accounts cannot be self-deleted. Contact another administrator.
            </p>
          </mat-card-content>
        </mat-card>
      }

      <!-- Disconnect confirmation dialog -->
      @if (showDisconnectDialog()) {
        <div class="dialog-backdrop" (click)="cancelDisconnect()">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <h2>Disconnect {{ pendingProvider() | titlecase }}?</h2>
            <p>You will no longer be able to log in with {{ pendingProvider() | titlecase }}. Your DinnerBears account and all history will remain.</p>
            <div class="dialog-actions">
              <button mat-button (click)="cancelDisconnect()">Cancel</button>
              <button mat-raised-button color="warn" (click)="executeDisconnect()" [disabled]="disconnecting()">
                Disconnect {{ pendingProvider() | titlecase }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Only-auth-method warning dialog -->
      @if (showOnlyAuthDialog()) {
        <div class="dialog-backdrop" (click)="cancelDisconnect()">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <mat-icon class="dialog-warn-icon">warning</mat-icon>
            <h2>{{ pendingProvider() | titlecase }} is your only way to log in</h2>
            <p>Disconnecting it will permanently delete your account.</p>
            <p class="hint">To keep your account, cancel and add another login method first.</p>
            <div class="dialog-actions">
              <button mat-button (click)="cancelDisconnect()">Cancel</button>
              <button mat-raised-button color="warn" (click)="startDeleteFlow(); cancelDisconnect()">
                Delete My Account Instead
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete step 1 dialog -->
      @if (showDeleteStep1()) {
        <div class="dialog-backdrop">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <mat-icon class="dialog-warn-icon">delete_forever</mat-icon>
            <h2>Delete your DinnerBears account?</h2>
            <ul class="delete-details">
              <li>Your account will be <strong>immediately deactivated</strong>.</li>
              <li>All login credentials are removed now.</li>
              <li>Your name and email will be <strong>permanently deleted within 30 days</strong>.</li>
              <li>Event attendance history is retained anonymously.</li>
            </ul>
            <p class="hint">You will be logged out immediately and cannot undo this.</p>
            <div class="dialog-actions">
              <button mat-button (click)="showDeleteStep1.set(false)">Cancel</button>
              <button mat-raised-button color="warn" (click)="showDeleteStep1.set(false); showDeleteStep2.set(true)">
                Continue
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete step 2 dialog — type-to-confirm -->
      @if (showDeleteStep2()) {
        <div class="dialog-backdrop">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <h2>Confirm account deletion</h2>
            <p>Type <strong>DELETE</strong> to confirm:</p>
            <mat-form-field appearance="outline" class="confirm-field">
              <input matInput [formControl]="deleteConfirmCtrl" placeholder="DELETE" autocomplete="off" />
            </mat-form-field>
            <div class="dialog-actions">
              <button mat-button (click)="showDeleteStep2.set(false); deleteConfirmCtrl.reset()">Cancel</button>
              <button
                mat-raised-button
                color="warn"
                [disabled]="deleteConfirmCtrl.value !== 'DELETE' || deleting()"
                (click)="executeDelete()"
              >
                Permanently Delete My Account
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .settings-page {
      max-width: 640px;
      margin: 40px auto;
      padding: 0 16px 80px;
    }

    .page-title {
      font-size: 1.6rem;
      color: var(--db-brown-dark, #3d2b1f);
      margin: 0 0 24px;
    }

    .settings-card {
      margin-bottom: 24px;
      border-radius: 12px;
    }

    .loading-row {
      display: flex;
      justify-content: center;
      padding: 24px 0;
    }

    .provider-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 0;
    }

    .provider-info {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .provider-icon {
      width: 28px;
      height: 28px;
      object-fit: contain;
    }

    .provider-icon-mat {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: #888;
    }

    .provider-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .provider-name {
      font-weight: 500;
      font-size: 0.95rem;
    }

    .provider-email {
      font-size: 0.82rem;
      color: #666;
    }

    .provider-email.not-connected {
      color: #aaa;
      font-style: italic;
    }

    .only-method-label {
      font-size: 0.8rem;
      color: #888;
      font-style: italic;
    }

    .danger-zone-card {
      border: 2px solid #d32f2f;
    }

    .danger-title {
      color: #d32f2f !important;
    }

    .danger-description {
      color: #555;
      font-size: 0.9rem;
      margin: 0 0 16px;
    }

    .admin-note {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #888;
      font-size: 0.9rem;
    }

    /* Dialogs */
    .dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .dialog-panel {
      background: #fff;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      width: calc(100vw - 32px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }

    .dialog-panel h2 {
      margin: 0 0 12px;
      font-size: 1.2rem;
    }

    .dialog-panel p {
      color: #555;
      font-size: 0.92rem;
      margin: 0 0 12px;
      line-height: 1.55;
    }

    .dialog-warn-icon {
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
      color: #e65100;
      margin-bottom: 8px;
      display: block;
    }

    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 20px;
    }

    .delete-details {
      color: #555;
      font-size: 0.9rem;
      line-height: 1.7;
      padding-left: 20px;
      margin: 0 0 12px;
    }

    .hint {
      font-size: 0.85rem !important;
      color: #888 !important;
      font-style: italic;
    }

    .confirm-field {
      width: 100%;
      margin-top: 4px;
    }
  `],
})
export class AccountSettingsComponent implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly providers = signal<ConnectedProviders | null>(null);
  readonly loading = signal(true);
  readonly disconnecting = signal(false);
  readonly deleting = signal(false);

  readonly showDisconnectDialog = signal(false);
  readonly showOnlyAuthDialog = signal(false);
  readonly showDeleteStep1 = signal(false);
  readonly showDeleteStep2 = signal(false);
  readonly pendingProvider = signal<'google' | 'facebook' | null>(null);

  readonly deleteConfirmCtrl = new FormControl('');

  get currentUser() {
    return this.authService.currentUser;
  }

  ngOnInit(): void {
    this.loadProviders();
  }

  private loadProviders(): void {
    this.loading.set(true);
    this.accountService.getConnectedProviders().subscribe({
      next: (p) => { this.providers.set(p); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  confirmDisconnect(provider: 'google' | 'facebook'): void {
    this.pendingProvider.set(provider);
    this.showDisconnectDialog.set(true);
  }

  cancelDisconnect(): void {
    this.showDisconnectDialog.set(false);
    this.showOnlyAuthDialog.set(false);
    this.pendingProvider.set(null);
  }

  async executeDisconnect(): Promise<void> {
    const provider = this.pendingProvider();
    if (!provider) return;
    this.disconnecting.set(true);
    try {
      await firstValueFrom(this.accountService.disconnectProvider(provider));
      this.showDisconnectDialog.set(false);
      this.pendingProvider.set(null);
      this.snackBar.open(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected successfully.`, 'OK', { duration: 4000 });
      this.loadProviders();
    } catch (err) {
      const status = (err as HttpErrorResponse)?.status;
      const errorCode = (err as HttpErrorResponse)?.error?.error;
      this.showDisconnectDialog.set(false);
      if (status === 409 && errorCode === 'ONLY_AUTH_METHOD') {
        this.showOnlyAuthDialog.set(true);
      } else {
        this.snackBar.open('Something went wrong. Please try again.', 'OK', { duration: 4000 });
        this.pendingProvider.set(null);
      }
    } finally {
      this.disconnecting.set(false);
    }
  }

  startDeleteFlow(): void {
    this.showDeleteStep1.set(true);
  }

  async executeDelete(): Promise<void> {
    if (this.deleteConfirmCtrl.value !== 'DELETE') return;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.accountService.deleteAccount());
      this.showDeleteStep2.set(false);
      this.authService.currentUser.set(null);
      await this.router.navigate(['/'], { queryParams: { deleted: '1' } });
    } catch {
      this.snackBar.open('Something went wrong. Please try again.', 'OK', { duration: 4000 });
    } finally {
      this.deleting.set(false);
    }
  }
}
