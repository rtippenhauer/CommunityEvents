import { Component, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-ios-install-banner',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    @if (show()) {
      <div class="ios-banner">
        <mat-icon class="banner-icon">ios_share</mat-icon>
        <span class="banner-text">
          Install DinnerBears: tap <mat-icon class="inline-icon">ios_share</mat-icon> then <strong>Add to Home Screen</strong>
        </span>
        <button mat-icon-button class="dismiss-btn" (click)="dismiss()" aria-label="Dismiss">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }
  `,
  styles: [`
    .ios-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--db-primary);
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      z-index: 1000;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.2);
    }
    .banner-icon { flex-shrink: 0; }
    .banner-text { flex: 1; font-size: 0.85rem; line-height: 1.4; }
    .inline-icon { font-size: 1rem; width: 1rem; height: 1rem; vertical-align: middle; }
    .dismiss-btn { color: #fff; margin-left: auto; flex-shrink: 0; }
  `],
})
export class IosInstallBannerComponent implements OnInit {
  readonly show = signal(false);

  ngOnInit(): void {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = ('standalone' in navigator) && (navigator as any).standalone;
    const dismissed = sessionStorage.getItem('ios-banner-dismissed');
    if (isIos && !isStandalone && !dismissed) {
      this.show.set(true);
    }
  }

  dismiss(): void {
    this.show.set(false);
    sessionStorage.setItem('ios-banner-dismissed', '1');
  }
}
