import { RenderMode, ServerRoute } from '@angular/ssr';
import { APP_EDITION } from '../environments/edition';

export const serverRoutes: ServerRoute[] = APP_EDITION.isProOrHigher
  ? [
      {
        path: 'login',
        renderMode: RenderMode.Prerender
      },
      {
        path: '**',
        renderMode: RenderMode.Server
      }
    ]
  : [
      {
        path: '**',
        renderMode: RenderMode.Prerender
      }
    ];
