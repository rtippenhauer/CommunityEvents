import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { UnseenAchievement } from '../../../core/services/community.service';

const PATRIOTIC_COLORS = ['#B22234', '#FFFFFF', '#3C3B6E', '#C9933A'];

interface Particle {
  id: number;
  angle: number;
  dist: number;
  color: string;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  delay: number;
  particles: Particle[];
}

function buildBursts(): Burst[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: i,
    x: 10 + Math.random() * 80,
    y: 10 + Math.random() * 45,
    delay: i * 300 + Math.random() * 200,
    particles: Array.from({ length: 16 }, (_, j) => ({
      id: j,
      angle: (360 / 16) * j + Math.random() * 12,
      dist: 55 + Math.random() * 45,
      color: PATRIOTIC_COLORS[Math.floor(Math.random() * PATRIOTIC_COLORS.length)],
    })),
  }));
}

@Component({
  selector: 'app-achievement-splash',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <div class="splash" [class.patriotic]="isPatriotic">
      @if (isPatriotic) {
        <div class="fireworks">
          @for (burst of bursts; track burst.id) {
            <div
              class="burst"
              [style.left.%]="burst.x"
              [style.top.%]="burst.y"
              [style.animation-delay.ms]="burst.delay"
            >
              @for (p of burst.particles; track p.id) {
                <span
                  class="particle"
                  [style.--angle.deg]="p.angle"
                  [style.--dist.px]="p.dist"
                  [style.background]="p.color"
                ></span>
              }
            </div>
          }
        </div>
      }

      <div class="splash-card">
        <div class="splash-icon">
          @if (data.imagePath) {
            <img [src]="data.imagePath" [alt]="data.name" />
          } @else {
            <mat-icon>{{ data.icon }}</mat-icon>
          }
        </div>
        <div class="splash-label">Achievement Unlocked</div>
        <h2 class="splash-name">{{ data.name }}</h2>
        <p class="splash-desc">{{ data.description }}</p>
        @if (data.points > 0) {
          <div class="splash-points">+{{ data.points }} Bear Points</div>
        }
        @if (data.title) {
          <div class="splash-title-hint">New title unlocked: "{{ data.title }}"</div>
        }
        <button mat-raised-button color="primary" (click)="close()">Nice!</button>
      </div>
    </div>
  `,
  styles: [`
    .splash {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 300px;
      max-width: 420px;
      padding: 8px;
      overflow: hidden;
    }
    .splash-card {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 24px 20px 20px;
      background: #fffaf3;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    }
    .splash-icon {
      width: 84px;
      height: 84px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle, #fff7e6 0%, #f5e3bf 100%);
      box-shadow: 0 4px 18px rgba(201, 147, 58, 0.45);
      margin-bottom: 6px;
      mat-icon { font-size: 44px; width: 44px; height: 44px; color: #C9933A; }
      img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    }
    .splash-label {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #C9933A;
    }
    .splash-name { margin: 0; font-size: 1.4rem; font-weight: 700; color: #1E4D8C; }
    .splash-desc { margin: 0; font-size: 0.9rem; color: #666; line-height: 1.4; }
    .splash-points {
      font-size: 0.95rem;
      font-weight: 700;
      color: #2e7d32;
      background: #eaf6ea;
      padding: 4px 12px;
      border-radius: 999px;
    }
    .splash-title-hint { font-size: 0.8rem; color: #C9933A; font-weight: 600; }
    button { margin-top: 10px; }

    .fireworks {
      position: absolute;
      inset: 0;
      z-index: 1;
      overflow: hidden;
      pointer-events: none;
      background: linear-gradient(180deg, #0b1d3a 0%, #14274d 100%);
    }
    .burst {
      position: absolute;
      width: 0;
      height: 0;
      opacity: 0;
      animation: burst-appear 900ms ease-out forwards;
    }
    .particle {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      left: 0;
      top: 0;
      transform: rotate(var(--angle)) translateX(0);
      animation: particle-fly 900ms ease-out forwards;
      animation-delay: inherit;
    }
    @keyframes burst-appear {
      0% { opacity: 0; }
      1% { opacity: 1; }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes particle-fly {
      0% { transform: rotate(var(--angle)) translateX(0); opacity: 1; }
      100% { transform: rotate(var(--angle)) translateX(var(--dist)); opacity: 0; }
    }
  `],
})
export class AchievementSplashComponent {
  readonly data = inject<UnseenAchievement>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<AchievementSplashComponent>);

  readonly isPatriotic = this.data.key === 'patriotic_bear';
  readonly bursts = this.isPatriotic ? buildBursts() : [];

  close(): void {
    this.dialogRef.close();
  }
}
