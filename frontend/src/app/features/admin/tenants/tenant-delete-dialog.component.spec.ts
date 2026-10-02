import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { TenantDeleteDialogComponent } from './tenant-delete-dialog.component';
import { AdminTenant, TenantsAdminService } from '../../../core/services/tenants-admin.service';

/**
 * Deleting a community, and the two different bars it has to clear (v2-14).
 *
 * A real community needs the domain retyped. A demo does not, because the API
 * waives that gate for demos -- it is disposable by construction and deletes
 * itself within the week.
 *
 * The regression these exist for: the rule was written twice, in the button's
 * `[disabled]` and again as an early return in `remove()`. Only the first was
 * updated when demos stopped needing the confirmation, so the button enabled
 * itself and clicking it did **nothing at all** -- no request, no error, no
 * feedback. A test that only checked the disabled state would have passed.
 * These assert the service is actually called.
 */
describe('TenantDeleteDialogComponent', () => {
  let removeSpy: ReturnType<typeof vi.fn>;
  let closed: unknown;

  const tenant = (over: Partial<AdminTenant>): AdminTenant =>
    ({
      id: 7,
      slug: 'demo-09ce981e',
      domain: 'demo-09ce981e.stage.communityeventsproject.com',
      isRoot: false,
      status: 'active',
      isDemo: false,
      demoExpiresAt: null,
      lastActiveAt: null,
      eventCount: 8,
      locationCount: 5,
      memberCount: 13,
      mailDomain: '',
      ...over,
    }) as AdminTenant;

  async function setup(t: AdminTenant): Promise<TenantDeleteDialogComponent> {
    removeSpy = vi.fn().mockReturnValue(of({}));
    closed = undefined;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TenantDeleteDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { tenant: t } },
        { provide: MatDialogRef, useValue: { close: (v: unknown) => (closed = v) } },
        { provide: TenantsAdminService, useValue: { remove: removeSpy } },
      ],
    }).compileComponents();
    return TestBed.createComponent(TenantDeleteDialogComponent).componentInstance;
  }

  describe('a demo', () => {
    it('deletes on one click, with nothing typed', async () => {
      const c = await setup(tenant({ isDemo: true }));

      expect(c.canDelete()).toBe(true);
      c.remove();

      // The assertion that matters: the request actually went.
      expect(removeSpy).toHaveBeenCalledOnce();
      expect(closed).toBe(true);
    });
  });

  describe('a real community', () => {
    it('refuses until the domain is retyped', async () => {
      const c = await setup(tenant({ isDemo: false, status: 'suspended' }));

      expect(c.canDelete()).toBe(false);
      c.remove();
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('deletes once the domain matches', async () => {
      const c = await setup(tenant({ isDemo: false, status: 'suspended' }));
      c.confirmation.setValue('demo-09ce981e.stage.communityeventsproject.com');

      expect(c.canDelete()).toBe(true);
      c.remove();

      expect(removeSpy).toHaveBeenCalledOnce();
    });

    // Matches how the API normalises, so the form does not reject input the
    // server would have accepted.
    it('accepts the domain leniently', async () => {
      const c = await setup(tenant({ isDemo: false }));
      c.confirmation.setValue('  WWW.Demo-09ce981e.Stage.CommunityEventsProject.com  ');
      expect(c.canDelete()).toBe(true);
    });
  });
});
