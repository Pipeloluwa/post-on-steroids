import { Routes } from '@angular/router';
import { authGuard, authMatchGuard } from './guards/auth.guard';

export const routes: Routes = [
    {
        path: 'login',
        loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent)
    },
    {
        path: '',
        canMatch: [authMatchGuard],
        canActivate: [authGuard],
        loadComponent: () => import('./layouts/main.layout/main.layout').then(m => m.MainLayout),
        children: [
            {
                path: '',
                loadComponent: () => import('./components/workspace/workspace.component').then(m => m.WorkspaceComponent),
                pathMatch: 'full'
            },
            {
                path: 'capsules',
                loadComponent: () => import('./components/collections.component/collections.component').then(m => m.CollectionsComponent)
            },
            {
                path: 'export',
                loadComponent: () => import('./components/export.component/export.component').then(m => m.ExportComponent)
            },
            {
                path: 'import',
                loadComponent: () => import('./components/import.component/import.component').then(m => m.ImportComponent)
            },
            {
                path: 'utilities',
                loadComponent: () => import('./components/utility.component/utility.component').then(m => m.UtilityComponent)
            },
            {
                path: 'automation',
                loadComponent: () => import('./components/automation.component/automation.component').then(m => m.AutomationComponent)
            },
            {
                path: 'history',
                loadComponent: () => import('./components/history.component/history.component').then(m => m.HistoryComponent)
            }
        ]
    },
    {
        path: '**',
        redirectTo: ''
    }
];
