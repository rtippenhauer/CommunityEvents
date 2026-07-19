import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AnnouncementsService, Announcement } from '../../core/services/announcements.service';

@Component({
  selector: 'app-announcements-list',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-header">
      <h1>Announcements</h1>
    </div>

    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (announcements().length === 0) {
      <p class="empty">No announcements yet. Check back soon!</p>
    } @else {
      <div class="ann-list">
        @for (a of announcements(); track a.id) {
          <a class="ann-card" [routerLink]="['/announcements', a.id]">
            <div class="ann-meta">
              <span class="ann-date">{{ a.publishedAt | date: 'MMM d, y' }}</span>
              @if (a.city) {
                <mat-chip class="city-chip">{{ a.city.name }}</mat-chip>
              } @else {
                <mat-chip class="city-chip all-cities">All Cities</mat-chip>
              }
            </div>
            <h2 class="ann-title">{{ a.title }}</h2>
            <div class="ann-author">
              <mat-icon class="author-icon">person</mat-icon>
              {{ a.author.fullName }}
            </div>
          </a>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page-header {
        margin-bottom: 24px;
        h1 {
          margin: 0;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty {
        text-align: center;
        color: #999;
        padding: 48px 0;
      }
      .ann-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 720px;
      }
      .ann-card {
        display: block;
        background: #fff;
        border: 1px solid #e8e0d6;
        border-radius: 10px;
        padding: 16px 20px;
        text-decoration: none;
        color: inherit;
        transition:
          box-shadow 0.2s,
          transform 0.1s;
        &:hover {
          box-shadow: 0 4px 16px rgba(61, 28, 5, 0.12);
          transform: translateY(-1px);
        }
      }
      .ann-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .ann-date {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--db-primary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .city-chip {
        font-size: 0.68rem !important;
        height: 20px !important;
        padding: 0 8px !important;
      }
      .all-cities {
        --mat-chip-label-text-color: #666;
      }
      .ann-title {
        margin: 0 0 8px;
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .ann-author {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.78rem;
        color: #888;
      }
      .author-icon {
        font-size: 1rem;
        width: 1rem;
        height: 1rem;
      }
    `,
  ],
})
export class AnnouncementsListComponent implements OnInit {
  private readonly announcementsService = inject(AnnouncementsService);

  readonly announcements = signal<Announcement[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.announcementsService.getAll().subscribe({
      next: (list) => {
        this.announcements.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
