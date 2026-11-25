import { DestroyRef, Directive, ElementRef, OnDestroy, OnInit, PLATFORM_ID, Renderer2, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

@Directive({
  selector: '[appBodyPortal]'
})
export class BodyPortalDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private renderer = inject(Renderer2);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private commentAnchor: Comment | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const node = this.el.nativeElement;
    const parent = node.parentNode;
    if (parent && document.body && parent !== document.body) {
      this.commentAnchor = document.createComment('app-body-portal-anchor');
      parent.insertBefore(this.commentAnchor, node);
      this.renderer.appendChild(document.body, node);

      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(() => {
        if (!this.commentAnchor) return;
        const current = this.el.nativeElement;
        if (!this.commentAnchor.isConnected && current.parentNode === document.body) {
          this.commentAnchor.parentNode?.insertBefore(current, this.commentAnchor);
        } else if (this.commentAnchor.isConnected && current.parentNode !== document.body) {
          this.renderer.appendChild(document.body, current);
        }
      });
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
