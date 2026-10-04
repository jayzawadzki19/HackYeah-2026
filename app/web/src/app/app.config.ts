import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { EVENT_SOURCE_FACTORY } from './core/live/event-source';
import { MockEventSource } from './core/live/mock-event-source';
import { mockApiInterceptor } from '../testing/mock-api.interceptor';

const openStream = environment.mockApi ? (url: string) => new MockEventSource(url) : (url: string) => new EventSource(url);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withViewTransitions({ skipInitialTransition: true })),
    provideHttpClient(withFetch(), ...(environment.mockApi ? [withInterceptors([mockApiInterceptor])] : [])),
    provideEchartsCore({ echarts: () => import('./charts/echarts').then(module => module.echarts) }),
    { provide: EVENT_SOURCE_FACTORY, useValue: openStream },
  ],
};
