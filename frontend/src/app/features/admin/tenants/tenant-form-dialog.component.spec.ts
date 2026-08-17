import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TenantFormDialogComponent } from './tenant-form-dialog.component';
import { BrandConfigService } from '../../../core/services/brand-config.service';

/**
 * The mail-domain suggestion (REQ-TENANT-01.4).
 *
 * Worth testing at this level because the failure it guards against is silent:
 * mail sent from a domain with no MX record bounces with nothing surfaced
 * anywhere in the app. A suggestion that is confidently wrong is therefore
 * worse than no suggestion, so what this asserts is mostly where the component
 * declines to guess.
 */
describe('TenantFormDialogComponent mail domain', () => {
  const DEPLOYMENT = 'communityeventsproject.com';

  let fixture: ComponentFixture<TenantFormDialogComponent>;
  let component: TenantFormDialogComponent;

  const build = async (deploymentMailDomain = DEPLOYMENT): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TenantFormDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        {
          provide: BrandConfigService,
          useValue: { baseDomain: () => deploymentMailDomain },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TenantFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  const typeDomain = (domain: string): void => {
    component.form.controls.domain.setValue(domain);
  };

  const mailDomain = (): string => component.form.getRawValue().mailDomain;

  it('suggests the deployment domain for a community beneath it', async () => {
    // The common case, and the one Rob asked for: a starter community on a
    // subdomain of the project's own domain inherits mail that already works.
    await build();
    typeDomain('dayton.communityeventsproject.com');

    expect(mailDomain()).toBe(DEPLOYMENT);
    expect(component.suggestionApplies()).toBe(true);
  });

  it('declines to guess for a community on its own domain', async () => {
    // Prefilling daytonfood.org here would be asserting that it accepts mail,
    // which this app has no way to know. Blank still resolves to the
    // deployment default server-side, and the hint says so.
    await build();
    typeDomain('daytonfood.org');

    expect(mailDomain()).toBe('');
    expect(component.suggestionApplies()).toBe(false);
  });

  it('does not treat a lookalike suffix as being beneath the deployment', async () => {
    // notcommunityeventsproject.com ends with the deployment domain as a
    // string but is a different registrable domain entirely.
    await build();
    typeDomain('notcommunityeventsproject.com');

    expect(mailDomain()).toBe('');
  });

  it('never overwrites a value the operator typed', async () => {
    await build();
    component.form.controls.mailDomain.setValue('mail.dayton.test');
    component.form.controls.mailDomain.markAsDirty();

    typeDomain('dayton.communityeventsproject.com');

    expect(mailDomain()).toBe('mail.dayton.test');
    expect(component.suggestionApplies()).toBe(false);
  });

  it('leaves a deliberately cleared field cleared', async () => {
    // An operator who clears the suggestion has said something: that this
    // community should inherit rather than send from the deployment domain.
    await build();
    typeDomain('dayton.communityeventsproject.com');
    component.form.controls.mailDomain.setValue('');
    component.form.controls.mailDomain.markAsDirty();

    typeDomain('dayton2.communityeventsproject.com');

    expect(mailDomain()).toBe('');
  });

  it('withdraws the suggestion when the domain moves out from under it', async () => {
    await build();
    typeDomain('dayton.communityeventsproject.com');
    expect(mailDomain()).toBe(DEPLOYMENT);

    typeDomain('daytonfood.org');
    expect(mailDomain()).toBe('');
  });

  it('suggests nothing when the deployment has no mail domain of its own', async () => {
    await build('');
    typeDomain('dayton.communityeventsproject.com');

    expect(mailDomain()).toBe('');
  });
});
