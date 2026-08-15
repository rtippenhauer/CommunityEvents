import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminTenant {
  id: number;
  slug: string;
  domain: string;
  isRoot: boolean;
  status: 'active' | 'suspended';
  dbMode: string;
  createdAt: string;
  eventCount: number;
  locationCount: number;
}

export interface CreateTenantPayload {
  domain: string;
  slug?: string;
  status?: 'active' | 'suspended';
}

export type UpdateTenantPayload = Partial<CreateTenantPayload>;

/**
 * The tenant registry (REQ-TENANT-01.7).
 *
 * `system/` rather than `admin/`: these routes act on the whole deployment and
 * answer only on the root host, so they are gated by SystemAdminGuard rather
 * than by the ordinary role guard. There is deliberately no `delete` here
 * because the API exposes none -- taking a community offline is a status
 * change, which is reversible.
 */
@Injectable({ providedIn: 'root' })
export class TenantsAdminService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/system/tenants';

  getAll(): Observable<AdminTenant[]> {
    return this.http.get<AdminTenant[]>(this.base);
  }

  create(payload: CreateTenantPayload): Observable<AdminTenant> {
    return this.http.post<AdminTenant>(this.base, payload);
  }

  update(id: number, payload: UpdateTenantPayload): Observable<AdminTenant> {
    return this.http.patch<AdminTenant>(`${this.base}/${id}`, payload);
  }
}
