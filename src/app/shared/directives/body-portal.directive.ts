import { Directive, ElementRef, OnDestroy, OnInit, PLATFORM_ID, Renderer2, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Directive({
  selector: '[appBodyPortal]'
})
export class BodyPortalDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private renderer = inject(Renderer2);
  private platformId = inject(PLATFORM_ID);
  private commentAnchor: Comment | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const node = this.el.nativeElement;
    const parent = node.parentNode;
    if (parent && document.body && parent !== document.body) {
      this.commentAnchor = document.createComment('app-body-portal-anchor');
      parent.insertBefore(this.commentAnchor, node);
      this.renderer.appendChild(document.body, node);
    }
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const node = this.el.nativeElement;
    if (node.parentNode === document.body) {
      this.renderer.removeChild(document.body, node);
    }
    this.commentAnchor?.remove();
    this.commentAnchor = null;
  }
}
