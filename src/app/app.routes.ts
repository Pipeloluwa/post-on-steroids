import { Routes } from '@angular/router';
import { MainLayout } from './layouts/main.layout/main.layout';
import { WorkspaceComponent } from './components/workspace/workspace.component';
import { CollectionsComponent } from './components/collections.component/collections.component';
import { ExportComponent } from './components/export.component/export.component';
import { HistoryComponent } from './components/history.component/history.component';

export const routes: Routes = [
    {
        path: '',
        component: MainLayout,
        children: [
            {
                path: '',
                redirectTo: 'workspace',
                pathMatch: 'full'
            },
            {
                path: 'workspace',
                component: WorkspaceComponent
            },
            {
                path: 'collections',
                component: CollectionsComponent
            },
            {
                path: 'export',
                component: ExportComponent
            },
            {
                path: 'history',
                component: HistoryComponent
            }
        ]
    }
];
