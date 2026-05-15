import { Routes } from '@angular/router';
import { MainLayout } from './layouts/main.layout/main.layout';
import { WorkspaceComponent } from './components/workspace/workspace.component';
import { CollectionsComponent } from './components/collections.component/collections.component';
import { ExportComponent } from './components/export.component/export.component';
import { ImportComponent } from './components/import.component/import.component';
import { HistoryComponent } from './components/history.component/history.component';

export const routes: Routes = [
    {
        path: '',
        component: MainLayout,
        children: [
            {
                path: '',
                redirectTo: 'steroid',
                pathMatch: 'full'
            },
            {
                path: 'steroid',
                component: WorkspaceComponent
            },
            {
                path: 'capsules',
                component: CollectionsComponent
            },
            {
                path: 'export',
                component: ExportComponent
            },
            {
                path: 'import',
                component: ImportComponent
            },
            {
                path: 'history',
                component: HistoryComponent
            }
        ]
    }
];
