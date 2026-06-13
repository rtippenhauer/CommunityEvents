import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/notifications';

  readonly unreadCount = signal(0);
  readonly notifications = signal<AppNotification[]>([]);

  private pollInterval: ReturnType<typeof setInterval> | null = null;

  startPolling(): void {
    this.fetchUnreadCount();
    this.pollInterval = setInterval(() => this.fetchUnreadCount(), 60_000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  fetchUnreadCount(): void {
    this.http.get<{ count: number }>(`${this.base}/unread-count`).subscribe({
      next: ({ count }) => this.unreadCount.set(count),
      error: () => {},
    });
  }

  loadNotifications(): void {
    this.http.get<AppNotification[]>(this.base).subscribe({
      next: (list) => this.notifications.set(list),
      error: () => {},
    });
  }

  markRead(id: number): void {
    this.http.patch(`${this.base}/${id}/read`, {}).subscribe({
      next: () => {
        this.notifications.update((list) =>
          list.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        );
        this.unreadCount.update((c) => Math.max(0, c - 1));
      },
      error: () => {},
    });
  }

  markAllRead(): void {
    this.http.patch(`${this.base}/read-all`, {}).subscribe({
      next: () => {
        this.notifications.update((list) => list.map((n) => ({ ...n, isRead: true })));
        this.unreadCount.set(0);
      },
      error: () => {},
    });
  }
}
