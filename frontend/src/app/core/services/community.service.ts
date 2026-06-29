import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PointSummary {
  total: number;
  byType: Partial<Record<string, number>>;
}

export interface Achievement {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  title: string | null;
  isSecret: boolean;
  earnedAt?: string;
}

export interface AchievementsResponse {
  earned: Achievement[];
  locked: Achievement[];
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  fullName: string;
  profilePhotoPath: string | null;
  selectedTitle: string | null;
  totalPoints: number;
  topType: string | null;
  cityId: number;
  cityName: string;
  isNew: boolean;
}

@Injectable({ providedIn: 'root' })
export class CommunityService {
  private readonly http = inject(HttpClient);

  getLeaderboard(cityId?: number): Observable<LeaderboardEntry[]> {
    const params: Record<string, string> = {};
    if (cityId) params['cityId'] = String(cityId);
    return this.http.get<LeaderboardEntry[]>('/api/v1/leaderboard', { params });
  }

  getMyPoints(): Observable<PointSummary> {
    return this.http.get<PointSummary>('/api/v1/members/me/points');
  }

  getMyAchievements(): Observable<AchievementsResponse> {
    return this.http.get<AchievementsResponse>('/api/v1/members/me/achievements');
  }

  getMemberPoints(id: number): Observable<PointSummary> {
    return this.http.get<PointSummary>(`/api/v1/members/${id}/points`);
  }

  getMemberAchievements(id: number): Observable<AchievementsResponse> {
    return this.http.get<AchievementsResponse>(`/api/v1/members/${id}/achievements`);
  }

  selectTitle(title: string | null): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>('/api/v1/members/me/title', { title });
  }

  getAdminLedger(userId: number): Observable<any[]> {
    return this.http.get<any[]>(`/api/v1/admin/members/${userId}/points/ledger`);
  }

  adminRemovePoint(pointId: number): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`/api/v1/admin/points/${pointId}/remove`, {});
  }

  adminGrantAchievement(userId: number, key: string): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`/api/v1/admin/members/${userId}/achievements/grant`, { key });
  }

  adminRevokeAchievement(userId: number, achievementId: number): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`/api/v1/admin/members/${userId}/achievements/${achievementId}/revoke`, {});
  }
}
