import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminInboundMailComponent } from './admin-inbound-mail.component';
import { InboundMailService } from '../../../core/services/inbound-mail.service';

/**
 * Which endpoint this component asks is decided entirely by its `operator`
 * input, and getting that wrong is invisible rather than loud: the API answers
 * both callers correctly, so a component that asks the wrong one shows a real,
 * plausible screen of the wrong data.
 *
 * That is what shipped to stage on 2026-10-22. The initial load ran in the
 * **constructor**, where signal inputs are not yet set, so `operator()`
 * returned its declared default of `false` and the operator's screen fetched
 * one community's rows — while the template, which renders after inputs are
 * set, drew the deployment-wide heading and the "Matched no community" filter
 * on top of them. It read as a server fault for a while, because the API was
 * returning the right thing to anyone who asked it directly.
 */
describe('AdminInboundMailComponent', () => {
  const emptyPage = { rows: [], total: 0, page: 1, limit: 25, byOutcome: {} };
  let forCommunity: ReturnType<typeof vi.fn>;
  let forOperator: ReturnType<typeof vi.fn>;

  @Component({
    standalone: true,
    imports: [AdminInboundMailComponent],
    template: `<app-admin-inbound-mail [operator]="true" />`,
  })
  class OperatorHost {}

  @Component({
    standalone: true,
    imports: [AdminInboundMailComponent],
    template: `<app-admin-inbound-mail />`,
  })
  class CommunityHost {}

  beforeEach(() => {
    forCommunity = vi.fn().mockReturnValue(of(emptyPage));
    forOperator = vi.fn().mockReturnValue(of(emptyPage));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: InboundMailService, useValue: { forCommunity, forOperator } },
      ],
    });
  });

  it('asks the deployment-wide endpoint when it is the operator view', () => {
    const fixture = TestBed.createComponent(OperatorHost);
    fixture.detectChanges();

    expect(forOperator).toHaveBeenCalledTimes(1);
    expect(forCommunity).not.toHaveBeenCalled();
  });

  it('asks the per-community endpoint by default', () => {
    const fixture = TestBed.createComponent(CommunityHost);
    fixture.detectChanges();

    expect(forCommunity).toHaveBeenCalledTimes(1);
    expect(forOperator).not.toHaveBeenCalled();
  });

  /**
   * `unresolvedOnly` is an operator-only filter, so it must never be sent by a
   * community's screen — the API ignores it there, but sending it would mean
   * the client believed it could widen its own view.
   */
  it('never sends the operator-only filter from a community screen', () => {
    const fixture = TestBed.createComponent(CommunityHost);
    fixture.detectChanges();

    expect(forCommunity.mock.calls[0][0].unresolvedOnly).toBeUndefined();
  });
});
