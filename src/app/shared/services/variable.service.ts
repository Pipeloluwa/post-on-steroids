import { Injectable, signal, inject } from '@angular/core';
import { LocalStorageService } from './local.storage.service';
import { IGlobalVariable, VariableSource } from '../../interfaces/services/IVariableService';
import { TabStateService } from './tab.state.service';

@Injectable({
    providedIn: 'root'
})
export class VariableService {
    private localStorageService = inject(LocalStorageService);
    private tabStateService = inject(TabStateService);

    variables = signal<IGlobalVariable[]>([]);

    // Confirmation Modal state for adding a variable
    showAddModal = signal<boolean>(false);
    modalKey = signal<string>('');
    modalValue = signal<string>('');
    modalSource = signal<VariableSource | undefined>(undefined);

    openAddModal(key: string = '', value: string = '', source?: VariableSource) {
        this.modalKey.set(key);
        this.modalValue.set(value);
        this.modalSource.set(source);
        this.showAddModal.set(true);
    }

    closeAddModal() {
        this.showAddModal.set(false);
        this.modalSource.set(undefined);
    }

    constructor() {
        this.loadVariables();
    }

    private loadVariables() {
        const saved = this.localStorageService.getItem(LocalStorageService.STORAGE_KEY);
        if (saved) {
            try {
                this.variables.set(JSON.parse(saved));
            } catch (e) {
                this.variables.set([]);
            }
        } else {
            // Default example variable
            this.variables.set([
                { id: '1', key: 'baseUrl', value: 'http://acegeld.runasp.net/api/v1', enabled: true }
            ]);
            this.saveVariables();
        }
    }

    private saveVariables() {
        this.localStorageService.setItem(LocalStorageService.STORAGE_KEY, JSON.stringify(this.variables()));
    }

    addVariable(key: string = '', value: string = '', source?: VariableSource) {
        const newVar: IGlobalVariable = {
            id: crypto.randomUUID(),
            key,
            value,
            enabled: true,
            source
        };
        this.variables.update(vars => [...vars, newVar]);
        this.saveVariables();
    }

    updateVariable(updatedVar: IGlobalVariable) {
        this.variables.update(vars => vars.map(v => v.id === updatedVar.id ? updatedVar : v));
        this.saveVariables();
    }

    removeVariable(id: string) {
        this.variables.update(vars => vars.filter(v => v.id !== id));
        this.saveVariables();
    }

    getVariableValue(v: IGlobalVariable): string {
        if (!v.source) {
            return v.value;
        }

        const state = this.tabStateService.getState(v.source.tabId) ||
            this.tabStateService.allCapsuleRequests().find(r => r.id === v.source?.tabId);

        if (!state) {
            return v.value;
        }

        const prop = v.source.propertyKey?.trim();

        if (v.source.type === 'header') {
            if (!prop) return v.value;
            const match = state.headers?.find(h => h.key.trim().toLowerCase() === prop.toLowerCase());
            return match && match.value !== undefined ? match.value : v.value;
        }

        if (v.source.type === 'param') {
            if (!prop) return v.value;
            const match = state.params?.find(p => p.key.trim().toLowerCase() === prop.toLowerCase());
            return match && match.value !== undefined ? match.value : v.value;
        }

        if (v.source.type === 'body') {
            const raw = state.rawBodyJson || state.rawBody;
            if (prop && raw) {
                const extracted = this.extractValue(raw, prop);
                if (extracted !== undefined && extracted !== null) {
                    return typeof extracted === 'object' ? JSON.stringify(extracted) : String(extracted);
                }
            }
            return v.value;
        }

        if (v.source.type === 'response') {
            if (prop && state.responseBody !== undefined && state.responseBody !== null) {
                const extracted = this.extractValue(state.responseBody, prop);
                if (extracted !== undefined && extracted !== null) {
                    return typeof extracted === 'object' ? JSON.stringify(extracted) : String(extracted);
                }
            }
            return v.value;
        }

        return v.value;
    }

    private extractValue(data: any, path: string): any {
        if (!path) return undefined;
        let current = data;

        if (typeof current === 'string') {
            try {
                current = JSON.parse(current);
            } catch {
                // Try XML tag extraction: e.g. <token>xyz</token>
                const tagRegex = new RegExp(`<${path}[^>]*>([\\s\\S]*?)<\\/${path}>`, 'i');
                const match = current.match(tagRegex);
                if (match) return match[1].trim();

                const attrRegex = new RegExp(`<${path}[^>]*value=["']([^"']*)["']`, 'i');
                const attrMatch = current.match(attrRegex);
                if (attrMatch) return attrMatch[1].trim();

                return undefined;
            }
        }

        if (current && typeof current === 'object') {
            if (path in current) {
                return current[path];
            }
            // Support dot navigation
            const parts = path.split('.');
            let temp = current;
            for (const p of parts) {
                if (temp && typeof temp === 'object' && p in temp) {
                    temp = temp[p];
                } else {
                    return undefined;
                }
            }
            return temp;
        }

        return undefined;
    }

    resolve(text: string): string {
        let resolvedText = text;
        this.variables().forEach(v => {
            if (v.enabled && v.key) {
                const dynamicVal = this.getVariableValue(v);
                const regex = new RegExp(`{{\\s*${v.key.trim()}\\s*}}`, 'g');
                resolvedText = resolvedText.replace(regex, dynamicVal.trim());
            }
        });
        return resolvedText;
    }
}
