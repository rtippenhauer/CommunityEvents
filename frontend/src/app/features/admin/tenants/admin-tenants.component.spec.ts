import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminTenantsComponent } from './admin-tenants.component';
import {
  AdminTenant,
  PendingDemoRequest,
} from '../../../core/services/tenants-admin.service';

/**
 * Filtering and ordering the community registry (v2-14).
 *
 * Worth testing on its own because the interesting cases are all about missing
 * values: only demos have an expiry, and a community nobody has signed into has
 * no last-used date. Both are the *common* case here, not the edge one, and
 * getting either backwards puts the least relevant rows at the top of a list
 * the operator is scanning.
 */
describe('AdminTenantsComponent list controls', () => {
  let component: AdminTenantsComponent;

  const tenant = (over: Partial<AdminTenant>): AdminTenant =>
    ({
      id: 1,
      slug: 'x',
      domain: 'x.test',
      isRoot: false,
      status: 'active',
      isDemo: false,
      demoExpiresAt: null,
      lastActiveAt: null,
      eventCount: 0,
      locationCount: 0,
      memberCount: 0,
      mailDomain: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }) as AdminTenant;

  const day = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminTenantsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    component = TestBed.createComponent(AdminTenantsComponent).componentInstance;
  });

  const rows = [
    tenant({ id: 1, slug: 'root', isRoot: true, lastActiveAt: day(-1) }),
    tenant({ id: 2, slug: 'dayton', lastActiveAt: day(-30) }),
    tenant({ id: 3, slug: 'demo-a', isDemo: true, demoExpiresAt: day(6), lastActiveAt: day(-2) }),
    tenant({ id: 4, slug: 'demo-b', isDemo: true, demoExpiresAt: day(2) }),
  ];

  it('shows everything by default', () => {
    component.tenants.set(rows);
    expect(component.visibleTenants().map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it('filters to demos or to real communities', () => {
    component.tenants.set(rows);

    component.filter.set('demo');
    expect(component.visibleTenants().map((t) => t.slug)).toEqual(['demo-a', 'demo-b']);

    component.filter.set('real');
    expect(component.visibleTenants().map((t) => t.slug)).toEqual(['root', 'dayton']);
  });

  it('counts each kind for the filter labels', () => {
    component.tenants.set(rows);
    expect(component.demoCount()).toBe(2);
    expect(component.realCount()).toBe(2);
  });

  // Soonest first, and the communities that never expire go last rather than
  // being treated as expiring at the epoch.
  it('sorts by expiry with never-expiring communities last', () => {
    component.tenants.set(rows);
    component.sort.set('expires');

    const order = component.visibleTenants().map((t) => t.slug);
    expect(order.slice(0, 2)).toEqual(['demo-b', 'demo-a']);
    expect(order.slice(2).sort()).toEqual(['dayton', 'root']);
  });

  // Most recent first, and "never signed in" is not "most recent".
  it('sorts by last used with never-used last', () => {
    component.tenants.set(rows);
    component.sort.set('lastUsed');

    expect(component.visibleTenants().map((t) => t.slug)).toEqual([
      'root',
      'demo-a',
      'dayton',
      'demo-b',
    ]);
  });

  it('combines a filter with a sort', () => {
    component.tenants.set(rows);
    component.filter.set('demo');
    component.sort.set('expires');

    expect(component.visibleTenants().map((t) => t.slug)).toEqual(['demo-b', 'demo-a']);
  });

  // The default must be the API's own order untouched, so "Name" shows exactly
  // what the unsorted list showed rather than a second, subtly different order.
  it('leaves the default order alone', () => {
    component.tenants.set(rows);
    component.sort.set('default');
    expect(component.visibleTenants()).toEqual(rows);
  });

  describe('lastUsedLabel', () => {
    it('says so plainly when nobody has ever signed in', () => {
      expect(component.lastUsedLabel(tenant({ lastActiveAt: null }))).toBe('Never signed in');
    });

    it('reads as relative time, so nobody has to do the subtraction', () => {
      expect(component.lastUsedLabel(tenant({ lastActiveAt: day(0) }))).toBe('Active today');
      expect(component.lastUsedLabel(tenant({ lastActiveAt: day(-1) }))).toBe('Active yesterday');
      expect(component.lastUsedLabel(tenant({ lastActiveAt: day(-9) }))).toBe('Active 9 days ago');
    });
  });

  /**
   * Demo requests that produced no community (v2-14).
   *
   * The label carries two different facts and the operator needs both: when
   * somebody asked says whether this is a person currently trying to get in,
   * and whether the link still works says whether the request is holding a
   * slot.
   */
  describe('requestLabel', () => {
    const hour = 3_600_000;
    const req = (over: Partial<PendingDemoRequest>): PendingDemoRequest => ({
      id: 1,
      fullName: 'Casual Visitor',
      email: 'visitor@example.test',
      ipAddress: '203.0.113.4',
      requestedAt: new Date(Date.now() - 2 * hour).toISOString(),
      expiresAt: new Date(Date.now() + 22 * hour).toISOString(),
      status: 'awaiting',
      ...over,
    });

    it('says when they asked and how long the link has left', () => {
      expect(component.requestLabel(req({}))).toBe('Asked 2 hours ago — link expires in 22 hours');
    });

    it('says the link is gone rather than counting down past zero', () => {
      const label = component.requestLabel(
        req({ status: 'lapsed', expiresAt: new Date(Date.now() - hour).toISOString() }),
      );
      expect(label).toBe('Asked 2 hours ago — link expired');
    });

    // Minutes and days, because a request made four minutes ago and one made
    // four days ago mean opposite things and "0 hours" says neither.
    it('scales the unit to the age', () => {
      expect(component.requestLabel(req({ requestedAt: new Date().toISOString() }))).toContain(
        'just now',
      );
      expect(
        component.requestLabel(
          req({ requestedAt: new Date(Date.now() - 4 * 60_000).toISOString() }),
        ),
      ).toContain('4 minutes ago');
      expect(
        component.requestLabel(
          req({
            requestedAt: new Date(Date.now() - 4 * 24 * hour).toISOString(),
            status: 'lapsed',
          }),
        ),
      ).toContain('4 days ago');
    });

    /**
     * The address is on screen so two refusals can be compared, which means
     * what is shown has to be the bucket the cap counted -- an IPv6 client is
     * stored as its /64 -- rather than something that looks like a single
     * address and is not.
     */
    describe('ipLabel', () => {
      it('shows an IPv4 address as it was counted', () => {
        expect(component.ipLabel(req({ ipAddress: '74.115.41.25' }))).toBe('74.115.41.25');
      });

      it('marks an IPv6 bucket as the prefix it is', () => {
        expect(component.ipLabel(req({ ipAddress: '2600:2b00:945e:9000::' }))).toBe(
          '2600:2b00:945e:9000::/64',
        );
      });

      // Blank reads as a rendering fault; this is a real state, and it changes
      // which caps applied.
      it('says so when no address was recorded', () => {
        expect(component.ipLabel(req({ ipAddress: null }))).toBe('no address recorded');
        expect(component.ipTooltip(req({ ipAddress: null }))).toContain('pool cap');
      });
    });

    it('does not say "1 hours"', () => {
      expect(
        component.requestLabel(
          req({
            requestedAt: new Date(Date.now() - hour).toISOString(),
            expiresAt: new Date(Date.now() + hour).toISOString(),
          }),
        ),
      ).toBe('Asked 1 hour ago — link expires in 1 hour');
    });
  });
});
