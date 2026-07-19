import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MerchService, MerchLinks } from '../../core/services/merch.service';

@Component({
  selector: 'app-merch',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="merch-page">
      <h1>DinnerBears Merch</h1>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else if (!links()?.storeUrl && !links()?.foundingBearProductUrl) {
        <mat-card class="store-card">
          <mat-card-content>
            <div class="store-icon">🐻</div>
            <h3>The DinnerBears Store</h3>
            <p>The store is closed right now — check back soon!</p>
          </mat-card-content>
        </mat-card>
      } @else {
        @if (links()?.storeUrl; as storeUrl) {
          <mat-card class="store-card">
            <mat-card-content>
              <div class="store-icon">🐻</div>
              <h3>The DinnerBears Store</h3>
              <p>Bear-themed tees, hats, and more — printed and shipped by Printful.</p>
              <a mat-raised-button color="primary" [href]="storeUrl" target="_blank" rel="noopener">
                <mat-icon>storefront</mat-icon> Visit the Store
              </a>
            </mat-card-content>
          </mat-card>
        }

        @if (links()?.foundingBearProductUrl; as exclusiveUrl) {
          <mat-card class="exclusive-card">
            <mat-card-content>
              <div class="store-icon">🏆</div>
              <h3>Founding Bear Exclusive</h3>
              <p>
                A special tee only available to Founding Bears — thanks for being here from the
                start.
              </p>
              <a
                mat-raised-button
                color="accent"
                [href]="exclusiveUrl"
                target="_blank"
                rel="noopener"
              >
                <mat-icon>redeem</mat-icon> Get Your Exclusive Tee
              </a>
            </mat-card-content>
          </mat-card>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .merch-page {
        max-width: 640px;
        margin: 0 auto;
        padding: 16px;
        h1 {
          margin: 0 0 20px;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      mat-card {
        margin-bottom: 20px;
      }
      .store-card,
      .exclusive-card {
        text-align: center;
        padding: 8px;
      }
      .exclusive-card {
        border: 2px solid var(--db-gold, #c9933a);
      }
      .store-icon {
        font-size: 2.5rem;
        margin-bottom: 8px;
      }
      h3 {
        margin: 0 0 8px;
      }
      p {
        color: #666;
        margin: 0 0 16px;
      }
    `,
  ],
})
export class MerchComponent implements OnInit {
  private readonly merchService = inject(MerchService);

  readonly links = signal<MerchLinks | null>(null);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.merchService.getLinks().subscribe({
      next: (l) => {
        this.links.set(l);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
