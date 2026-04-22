if (typeof global !== 'undefined') {
  (global as any).self = global;
  (global as any).window = global;
  if (!(global as any).document) {
    (global as any).document = {
      createElement: () => ({}),
      body: {},
      documentElement: {},
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;
  }
}

import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes))
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
