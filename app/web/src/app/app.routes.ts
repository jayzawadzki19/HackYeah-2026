import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'jakub/briefing' },
  {
    path: ':user',
    loadComponent: () => import('./shell/shell').then(module => module.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'briefing' },
      { path: 'briefing', loadComponent: () => import('./features/briefing/briefing-page').then(module => module.BriefingPage) },
      { path: 'week', loadComponent: () => import('./features/week/week-page').then(module => module.WeekPage) },
      { path: 'meetings/:id', loadComponent: () => import('./features/meeting/meeting-page').then(module => module.MeetingPage) },
      { path: 'energy-map', loadComponent: () => import('./features/energy-map/energy-map-page').then(module => module.EnergyMapPage) },
      { path: 'check-in', loadComponent: () => import('./features/check-in/check-in-page').then(module => module.CheckInPage) },
    ],
  },
];
