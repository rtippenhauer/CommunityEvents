import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { NotificationsService } from '../../../core/services/notifications.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [DatePipe, MatBadgeModule, MatButtonModule, MatDividerModule, MatIconModule, MatMenuModule],
  template: `
    <button
      mat-icon-button
      [matMenuTriggerFor]="notifMenu"
      (menuOpened)="onOpen()"
      aria-label="Notifications"
      class="bell-btn"
    >
      <mat-icon
        [matBadge]="unreadCount() || null"
        matBadgeColor="warn"
        [matBadgeHidden]="unreadCount() === 0"
      >notifications</mat-icon>
    </button>

    <mat-menu #notifMenu="matMenu" class="notif-menu" xPosition="before">
      <div class="notif-header" (click)="$event.stopPropagation()">
        <span class="notif-title">Notifications</span>
        @if (unreadCount() > 0) {
          <button mat-button class="mark-all-btn" (click)="markAllRead()">Mark all read</button>
        }
      </div>
      <mat-divider />

      @if (notifications().length === 0) {
        <div class="notif-empty" (click)="$event.stopPropagation()">No notifications yet</div>
      } @else {
        @for (n of notifications(); track n.id) {
          <div
            class="notif-item"
            [class.unread]="!n.isRead"
            (click)="onNotifClick(n)"
          >
            <div class="notif-dot-wrap">
              @if (!n.isRead) { <span class="notif-dot"></span> }
            </div>
            <div class="notif-content">
              <div class="notif-item-title">{{ n.title }}</div>
              @if (n.body) { <div class="notif-body">{{ n.body }}</div> }
              <div class="notif-time">{{ n.createdAt | date:'MMM d, h:mm a' }}</div>
            </div>
          </div>
        }
      }
    </mat-menu>
  `,
  styles: [`
    .bell-btn { position: relative; }
    ::ng-deep .notif-menu .mat-mdc-menu-panel {
      width: 320px;
      max-height: 460px;
      overflow-y: auto;
    }
    .notif-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px 6px;
      .notif-title { font-weight: 600; font-size: 0.9rem; color: var(--db-brown-dark); }
    }
    .mark-all-btn { font-size: 0.75rem; padding: 0 8px; min-width: 0; height: 28px; }
    .notif-empty { padding: 20px 16px; font-size: 0.85rem; color: #999; text-align: center; }
    .notif-item {
      display: flex;
      gap: 10px;
      padding: 10px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f0ebe4;
      &:hover { background: var(--db-cream); }
      &.unread { background: #f5f0e8; }
    }
    .notif-dot-wrap { width: 10px; flex-shrink: 0; padding-top: 5px; }
    .notif-dot { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--db-primary); }
    .notif-content { flex: 1; min-width: 0; }
    .notif-item-title { font-size: 0.85rem; font-weight: 600; color: var(--db-brown-dark); line-height: 1.3; }
    .notif-body { font-size: 0.78rem; color: #666; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .notif-time { font-size: 0.72rem; color: #aaa; margin-top: 3px; }
  `],
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private readonly notifService = inject(NotificationsService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly unreadCount = this.notifService.unreadCount;
  readonly notifications = this.notifService.notifications;

  ngOnInit(): void {
    if (this.authService.isLoggedIn()) {
      this.notifService.startPolling();
    }
  }

  ngOnDestroy(): void {
    this.notifService.stopPolling();
  }

  onOpen(): void {
    this.notifService.loadNotifications();
  }

  onNotifClick(n: { id: number; isRead: boolean; actionUrl: string | null }): void {
    if (!n.isRead) this.notifService.markRead(n.id);
    if (n.actionUrl) void this.router.navigateByUrl(n.actionUrl);
  }

  markAllRead(): void {
    this.notifService.markAllRead();
  }
}
