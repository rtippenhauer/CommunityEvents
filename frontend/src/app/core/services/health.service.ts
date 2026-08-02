import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface HealthInfo {
  status: string;
  version: string;
  gitCommit: string;
}

// Surfaces the running build's version/commit somewhere visible in the UI
// (footer) — added after repeatedly needing to confirm via curl whether a
// deploy actually landed vs. an Unraid template re-pinning the old image.
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  readonly health = signal<HealthInfo | null>(null);

  load(): void {
    this.http.get<HealthInfo>('/api/v1/health').subscribe({
      next: (h) => this.health.set(h),
      error: () => this.health.set(null),
    });
  }
}
