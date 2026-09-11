import { ApplicationConfig, provideBrowserGlobalErrorListeners, importProvidersFrom } from '@angular/core';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MonacoEditorModule, NgxMonacoEditorConfig } from 'ngx-monaco-editor-v2';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { CustomRouteReuseStrategy } from './custom-route-reuse.strategy';
import { authInterceptor } from './shared/interceptors/auth.interceptor';
import { requestIdInterceptor } from './shared/interceptors/request-id.interceptor';

const monacoConfig: NgxMonacoEditorConfig = {
  onMonacoLoad: () => {
    const monaco = (window as any).monaco;
    if (monaco && monaco.languages && monaco.languages.json) {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true
      });
    }
  }
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([requestIdInterceptor, authInterceptor])),
    provideClientHydration(withEventReplay()),
    importProvidersFrom(MonacoEditorModule.forRoot(monacoConfig)),
    { provide: RouteReuseStrategy, useClass: CustomRouteReuseStrategy }
  ]
};
