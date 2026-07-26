import { Component, inject, input, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface MemberCardData {
  id: number;
  fullName: string;
  email?: string;
  profilePhotoPath: string | null;
  role?: string;
  status?: string;
  hasFacebook?: boolean;
  facebookProfileUrl?: string | null;
  googleEmail?: string | null;
}

// Module-level cache shared across all instances
const cardCache = new Map<number, MemberCardData>();

@Component({
  selector: 'app-member-hover-card',
  standalone: true,
  imports: [RouterLink, MatChipsModule, MatProgressSpinnerModule],
  template: `
    @if (loading()) {
      <div class="card-loading"><mat-spinner diameter="24" /></div>
    } @else if (member()) {
      <div class="card-inner">
        <a [routerLink]="['/members', member()!.id]" class="card-avatar">
          <img
            [src]="member()!.profilePhotoPath ?? '/assets/default-avatar.svg'"
            [alt]="member()!.fullName"
          />
        </a>
        <div class="card-body">
          <a [routerLink]="['/members', member()!.id]" class="card-name">{{
            member()!.fullName
          }}</a>
          @if (member()!.role && member()!.role !== 'member') {
            <mat-chip [class]="'role-' + member()!.role">{{ member()!.role }}</mat-chip>
          }
          @if (member()!.status === 'suspended') {
            <mat-chip class="chip-banned">Banned</mat-chip>
          }
          @if (member()!.email) {
            <a [href]="'mailto:' + member()!.email" class="card-email">{{ member()!.email }}</a>
          }
          <div class="card-badges">
            @if (member()!.hasFacebook) {
              @if (member()!.facebookProfileUrl) {
                <a
                  [href]="member()!.facebookProfileUrl!"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="provider-badge badge-fb"
                  title="View Facebook profile"
                  >Facebook</a
                >
              } @else {
                <span class="provider-badge badge-fb" title="Facebook connected">Facebook</span>
              }
            }
            @if (member()!.googleEmail) {
              <a
                [href]="'https://mail.google.com/mail/?view=cm&fs=1&to=' + member()!.googleEmail"
                target="_blank"
                rel="noopener noreferrer"
                class="provider-badge badge-g"
                [title]="member()!.googleEmail!"
                >Gmail</a
              >
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
        padding: 14px;
        min-width: 220px;
        max-width: 280px;
        pointer-events: auto;
      }
      .card-loading {
        display: flex;
        justify-content: center;
        padding: 12px;
      }
      .card-inner {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .card-avatar {
        width: 52px;
        height: 52px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        display: block;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center top;
        }
      }
      .card-body {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .card-name {
        font-weight: 600;
        font-size: 0.9rem;
        color: var(--db-primary);
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        &:hover {
          text-decoration: underline;
        }
      }
      .card-email {
        font-size: 0.72rem;
        color: #888;
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        &:hover {
          color: var(--db-primary);
          text-decoration: underline;
        }
      }
      .card-badges {
        display: flex;
        gap: 5px;
        margin-top: 4px;
        flex-wrap: wrap;
      }
      .provider-badge {
        font-size: 0.7rem;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 12px;
        text-decoration: none;
        display: inline-block;
      }
      .badge-fb {
        background: #1877f2;
        color: #fff;
      }
      .badge-g {
        background: #ea4335;
        color: #fff;
      }
      mat-chip {
        font-size: 0.65rem !important;
        min-height: 18px !important;
      }
      .role-admin {
        --mat-chip-label-text-color: #fff;
        background: var(--db-primary) !important;
      }
      .role-moderator {
        --mat-chip-label-text-color: #fff;
        background: var(--db-primary) !important;
      }
      .chip-banned {
        background: #ffccbc !important;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'member-hover-card' },
})
export class MemberHoverCardComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly userId = input.required<number>();

  readonly loading = signal(false);
  readonly member = signal<MemberCardData | null>(null);

  ngOnInit(): void {
    const cached = cardCache.get(this.userId());
    if (cached) {
      this.member.set(cached);
      return;
    }
    this.loading.set(true);
    this.http.get<MemberCardData>(`/api/v1/users/${this.userId()}`).subscribe({
      next: (data) => {
        cardCache.set(data.id, data);
        this.member.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
