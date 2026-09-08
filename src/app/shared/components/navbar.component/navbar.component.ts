import { Component, ChangeDetectionStrategy, input, output, computed, signal, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { SidebarService } from '../../services/sidebar.service';
import { TabStateService } from '../../services/tab.state.service';
import { NotificationService } from '../../services/notification.service';
import { AboutModalComponent } from '../about.modal.component/about.modal.component';
import { HelpUpdatesModalComponent } from '../help-updates.modal.component/help-updates.modal.component';
import { CreateCapsuleModalComponent } from '../create-capsule.modal.component/create-capsule.modal.component';

@Component({
    selector: 'app-navbar-component',
    imports: [
        CommonModule,
        RouterModule,
        MatIcon,
        AboutModalComponent,
        HelpUpdatesModalComponent,
        CreateCapsuleModalComponent
    ],
    templateUrl: './navbar.component.html',
    styleUrl: './navbar.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:click)': 'onDocumentClick()',
        '(window:keydown)': 'onKeydown($event)'
    }
})
export class NavbarComponent {
    title = input.required<string>();
    isLoggedIn = input.required<boolean>();
    userEmail = input.required<string>();

    onToggleAuth = output<void>();
    onLogout = output<void>();

    sidebarService = inject(SidebarService);
    tabStateService = inject(TabStateService);
    private router = inject(Router);
    private notificationService = inject(NotificationService);

    @ViewChild('createCapsuleModal') createCapsuleModal?: CreateCapsuleModalComponent;

    showFileMenu = signal<boolean>(false);
    showAboutModal = signal<boolean>(false);
    showHelpModal = signal<boolean>(false);

    toggleSidebar() {
        this.sidebarService.toggle();
    }

    userInitials = computed(() => {
        const email = this.userEmail();
        if (!email) return '??';
        const parts = email.split('@')[0].split(/[._-]/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return email.substring(0, 2).toUpperCase();
    });

    toggleFileMenu(event: MouseEvent) {
        event.stopPropagation();
        this.showFileMenu.update(v => !v);
    }

    closeFileMenu() {
        this.showFileMenu.set(false);
    }

    openAbout() {
        this.showFileMenu.set(false);
        this.showAboutModal.set(true);
    }

    openHelp() {
        this.showFileMenu.set(false);
        this.showHelpModal.set(true);
    }

    newRequest() {
        this.showFileMenu.set(false);
        this.tabStateService.createAndOpenNewTab();
        this.router.navigate(['/steroid']);
        this.notificationService.notify('New request tab created.');
    }

    newCapsule() {
        this.showFileMenu.set(false);
        this.createCapsuleModal?.open();
    }

    async saveCurrentRequest() {
        this.showFileMenu.set(false);
        const activeId = this.tabStateService.activeTabId();
        if (!activeId) {
            this.notificationService.notify('No active request to save.');
            return;
        }
        await this.tabStateService.saveToCapsule(activeId);
        this.notificationService.notify('Request saved successfully to capsule.');
    }

    importOpen() {
        this.showFileMenu.set(false);
        this.router.navigate(['/import']);
    }

    exportEndpoint() {
        this.showFileMenu.set(false);
        const activeId = this.tabStateService.activeTabId();
        const state = activeId ? this.tabStateService.getState(activeId) : null;
        if (!state) {
            this.notificationService.notify('No active request to export.');
            return;
        }
        this.downloadJson(state, `request_${state.name || 'untitled'}.json`);
        this.notificationService.notify('Endpoint exported successfully.');
    }

    exportCapsule() {
        this.showFileMenu.set(false);
        const colName = this.tabStateService.activeCapsuleName() || 'capsule';
        const requests = this.tabStateService.savedCapsules();
        this.downloadJson({
            collection: colName,
            exportedAt: new Date().toISOString(),
            requests
        }, `capsule_${colName}.json`);
        this.notificationService.notify(`Capsule "${colName}" exported successfully.`);
    }

    closeActiveTab() {
        this.showFileMenu.set(false);
        const activeId = this.tabStateService.activeTabId();
        if (activeId) {
            this.tabStateService.closeTab(activeId);
        }
    }

    closeAllTabs() {
        this.showFileMenu.set(false);
        this.tabStateService.closeAllTabs();
        this.notificationService.notify('Closed all tabs.');
    }

    private downloadJson(data: any, filename: string) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    onDocumentClick() {
        if (this.showFileMenu()) {
            this.showFileMenu.set(false);
        }
    }

    onKeydown(event: KeyboardEvent) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            this.saveCurrentRequest();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
            event.preventDefault();
            this.importOpen();
        }
    }
}
