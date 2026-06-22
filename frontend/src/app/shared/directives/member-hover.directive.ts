import {
  ComponentRef,
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  ViewContainerRef,
} from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { MemberHoverCardComponent } from '../components/member-hover-card/member-hover-card.component';

@Directive({ selector: '[appMemberHover]', standalone: true })
export class MemberHoverDirective implements OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly vcr = inject(ViewContainerRef);

  readonly appMemberHover = input.required<number>();

  private overlayRef: OverlayRef | null = null;
  private cardRef: ComponentRef<MemberHoverCardComponent> | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('mouseenter')
  onEnter(): void {
    this.cancelHide();
    if (this.overlayRef) return;
    this.showTimer = setTimeout(() => this.show(), 300);
  }

  @HostListener('mouseleave')
  onLeave(): void {
    this.cancelShow();
    this.hideTimer = setTimeout(() => this.hide(), 150);
  }

  private show(): void {
    if (this.overlayRef) return;

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.el)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
        { originX: 'start', originY: 'top',    overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
        { originX: 'end',   originY: 'bottom', overlayX: 'end',   overlayY: 'top', offsetY: 6 },
      ]);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: false,
      panelClass: 'member-hover-panel',
    });

    const portal = new ComponentPortal(MemberHoverCardComponent, this.vcr);
    this.cardRef = this.overlayRef.attach(portal);
    this.cardRef.setInput('userId', this.appMemberHover());

    // Keep card open while mouse is over it
    const el = this.overlayRef.overlayElement;
    el.addEventListener('mouseenter', () => this.cancelHide());
    el.addEventListener('mouseleave', () => {
      this.hideTimer = setTimeout(() => this.hide(), 150);
    });
  }

  private hide(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.cardRef = null;
  }

  private cancelShow(): void {
    if (this.showTimer) { clearTimeout(this.showTimer); this.showTimer = null; }
  }

  private cancelHide(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  ngOnDestroy(): void {
    this.cancelShow();
    this.cancelHide();
    this.hide();
  }
}
