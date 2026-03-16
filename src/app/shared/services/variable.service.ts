import { Injectable, signal, inject } from '@angular/core';
import { LocalStorageService } from './local.storage.service';
import { IGlobalVariable } from '../../interfaces/services/IVariableService';


@Injectable({
    providedIn: 'root'
})
export class VariableService {
    private localStorageService = inject(LocalStorageService);

    variables = signal<IGlobalVariable[]>([]);

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

    addVariable(key: string = '', value: string = '') {
        const newVar: IGlobalVariable = {
            id: crypto.randomUUID(),
            key,
            value,
            enabled: true
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

    resolve(text: string): string {
        let resolvedText = text;
        this.variables().forEach(v => {
            if (v.enabled && v.key) {
                const regex = new RegExp(`{{${v.key}}}`, 'g');
                resolvedText = resolvedText.replace(regex, v.value);
            }
        });
        return resolvedText;
    }
}
