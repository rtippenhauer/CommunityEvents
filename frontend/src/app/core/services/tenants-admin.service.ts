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
  memberCount: number;
  /** That community's own mail domain, or '' when it inherits the deployment's. */
  mailDomain: string;
}

/** One person inside a community, as seen from the system admin screens. */
export interface AdminTenantUser {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  isServiceAccount: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CreateTenantUserPayload {
  fullName: string;
  email: string;
  password: string;
  role?: string;
}

export interface UpdateTenantUserPayload {
  role?: string;
  status?: string;
}

export interface CreateTenantPayload {
  domain: string;
  slug?: string;
  status?: 'active' | 'suspended';
  /**
   * The new community's first admin. Optional to the API, but a community
   * created without one cannot be signed in to at all: registration needs an
   * invite, and invites need an existing member of that tenant.
   */
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
  /**
   * Domain the new community sends mail from. Blank inherits the deployment's,
   * which is correct whenever the community is a subdomain of it.
   */
  mailDomain?: string;
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

  /**
   * Permanently deletes a community and everything in it.
   *
   * The domain is sent in the body rather than the query string: it is the
   * confirmation, and a query string ends up in access logs and browser
   * history. HttpClient needs `body` inside the options object for DELETE.
   */
  remove(id: number, confirmDomain: string): Observable<{ id: number; domain: string }> {
    return this.http.delete<{ id: number; domain: string }>(`${this.base}/${id}`, {
      body: { confirmDomain },
    });
  }

  // ── People inside one community ──────────────────────────────────────────
  // Nested under the tenant so a request cannot reach a user without naming
  // which community it means.

  getUsers(tenantId: number): Observable<AdminTenantUser[]> {
    return this.http.get<AdminTenantUser[]>(`${this.base}/${tenantId}/users`);
  }

  createUser(tenantId: number, payload: CreateTenantUserPayload): Observable<AdminTenantUser> {
    return this.http.post<AdminTenantUser>(`${this.base}/${tenantId}/users`, payload);
  }

  updateUser(
    tenantId: number,
    userId: number,
    payload: UpdateTenantUserPayload,
  ): Observable<AdminTenantUser> {
    return this.http.patch<AdminTenantUser>(`${this.base}/${tenantId}/users/${userId}`, payload);
  }

  resetUserPassword(tenantId: number, userId: number, password: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(`${this.base}/${tenantId}/users/${userId}/password`, {
      password,
    });
  }
}
