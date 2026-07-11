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
  imagePath: string | null;
  title: string | null;
  points: number;
  progressType: string | null;
  progressTarget: number | null;
  progressCurrent: number;
  eventId: number | null;
  isSecret: boolean;
  earned: boolean;
  earnedAt: string | null;
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

export interface EventAchievement {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  imagePath: string | null;
  title: string | null;
  points: number;
  isSecret: boolean;
}

export interface CustomIcon {
  id: number;
  name: string;
  imagePath: string;
  createdAt: string;
  usageCount: number;
}

export interface UnseenAchievement {
  memberAchievementId: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  imagePath: string | null;
  points: number;
  title: string | null;
  earnedAt: string;
}

export interface AdminAchievement {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  imagePath: string | null;
  title: string | null;
  points: number;
  progressType: string | null;
  progressTarget: number | null;
  eventId: number | null;
  isSecret: boolean;
  earnedCount: number;
  createdAt: string;
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

  getMyAchievements(): Observable<Achievement[]> {
    return this.http.get<Achievement[]>('/api/v1/members/me/achievements');
  }

  getMemberPoints(id: number): Observable<PointSummary> {
    return this.http.get<PointSummary>(`/api/v1/members/${id}/points`);
  }

  getMemberAchievements(id: number): Observable<Achievement[]> {
    return this.http.get<Achievement[]>(`/api/v1/members/${id}/achievements`);
  }

  getUnseenAchievements(): Observable<UnseenAchievement[]> {
    return this.http.get<UnseenAchievement[]>('/api/v1/members/me/achievements/unseen');
  }

  markAchievementSeen(memberAchievementId: number): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`/api/v1/members/me/achievements/${memberAchievementId}/seen`, {});
  }

  selectTitle(title: string | null): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>('/api/v1/members/me/title', { title });
  }

  getEventAchievement(eventId: number): Observable<EventAchievement | null> {
    return this.http.get<EventAchievement | null>(`/api/v1/events/${eventId}/achievement`);
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

  adminCreateEventAchievement(
    eventId: number,
    dto: { name: string; description: string; title?: string; points: number; icon?: string; isSecret?: boolean },
  ): Observable<EventAchievement> {
    return this.http.post<EventAchievement>(`/api/v1/admin/events/${eventId}/achievement`, dto);
  }

  adminListAchievements(): Observable<AdminAchievement[]> {
    return this.http.get<AdminAchievement[]>('/api/v1/admin/achievements');
  }

  adminCreateAchievement(dto: {
    key: string; name: string; description: string; icon: string;
    progressType: string; progressTarget?: number | null;
    points: number; title?: string | null; isSecret: boolean;
  }): Observable<AdminAchievement> {
    return this.http.post<AdminAchievement>('/api/v1/admin/achievements', dto);
  }

  adminUpdateAchievement(
    id: number,
    dto: {
      name: string; description: string; icon: string;
      title?: string | null; points: number; isSecret: boolean;
      progressTarget?: number | null;
    },
  ): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`/api/v1/admin/achievements/${id}`, dto);
  }

  adminUploadAchievementImage(achievementId: number, file: File): Observable<{ imagePath: string }> {
    const fd = new FormData();
    fd.append('image', file);
    return this.http.post<{ imagePath: string }>(`/api/v1/admin/achievements/${achievementId}/image`, fd);
  }

  adminBackfillFounders(): Observable<{ granted: number }> {
    return this.http.post<{ granted: number }>('/api/v1/admin/achievements/backfill-founders', {});
  }

  adminRecalculatePoints(): Observable<{ updated: number; inserted: number }> {
    return this.http.post<{ updated: number; inserted: number }>(
      '/api/v1/admin/achievements/recalculate-points',
      {},
    );
  }

  adminBackfillInvitePoints(): Observable<{ pointsGranted: number; achievementsGranted: number }> {
    return this.http.post<{ pointsGranted: number; achievementsGranted: number }>(
      '/api/v1/admin/achievements/backfill-invites',
      {},
    );
  }

  listCustomIcons(): Observable<CustomIcon[]> {
    return this.http.get<CustomIcon[]>('/api/v1/admin/custom-icons');
  }

  createCustomIcon(name: string, image: Blob): Observable<CustomIcon> {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('image', image, 'icon.png');
    return this.http.post<CustomIcon>('/api/v1/admin/custom-icons', fd);
  }

  reprocessCustomIcon(id: number, image: Blob): Observable<CustomIcon> {
    const fd = new FormData();
    fd.append('image', image, 'icon.png');
    return this.http.post<CustomIcon>(`/api/v1/admin/custom-icons/${id}/reprocess`, fd);
  }

  deleteCustomIcon(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/v1/admin/custom-icons/${id}`);
  }
}
