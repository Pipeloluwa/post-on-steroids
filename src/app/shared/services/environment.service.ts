import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VariableService } from './variable.service';
import { generateUUID } from '../utils/uuid.util';

export interface EnvironmentVariableItem {
  id: string;
  key: string;
  value: string;
  type: 'default' | 'secret';
  enabled: boolean;
}

export interface ApiEnvironment {
  id: string;
  name: string;
  color: string;
  variables: EnvironmentVariableItem[];
  updatedAt: number;
}

const ENV_LIST_STORAGE_KEY = 'onsteroids_pro_environments';
const ACTIVE_ENV_STORAGE_KEY = 'onsteroids_pro_active_env';

@Injectable({
  providedIn: 'root'
})
export class EnvironmentService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private variableService = inject(VariableService);

  environments = signal<ApiEnvironment[]>(this.loadEnvironments());
  activeEnvironmentId = signal<string | null>(this.loadActiveEnvId());

  activeEnvironment = computed<ApiEnvironment | null>(() => {
    const id = this.activeEnvironmentId();
    if (!id) return null;
    return this.environments().find(e => e.id === id) || null;
  });

  constructor() {
    // Register active environment variable resolver so {{var}} overrides Capsule globals cleanly
    this.variableService.registerExternalResolver((rawKey: string) => {
      const env = this.activeEnvironment();
      if (!env) return undefined;
      const cleanTarget = rawKey.trim().toLowerCase();
      if (!cleanTarget) return undefined;
      const found = env.variables.find(v => v.enabled && v.key.trim().toLowerCase() === cleanTarget);
      return found ? (found.value ?? '') : undefined;
    });
  }

  private loadEnvironments(): ApiEnvironment[] {
    if (!this.isBrowser) return [];
    try {
      const raw = localStorage.getItem(ENV_LIST_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    // Seed standard DEV / SIT / UAT / PROD starter presets
    return [
      { id: 'env_dev', name: 'DEV', color: '#10b981', variables: [{ id: generateUUID(), key: 'baseUrl', value: 'http://localhost:5000', type: 'default', enabled: true }], updatedAt: Date.now() },
      { id: 'env_sit', name: 'SIT', color: '#3b82f6', variables: [{ id: generateUUID(), key: 'baseUrl', value: 'https://sit.example.com', type: 'default', enabled: true }], updatedAt: Date.now() },
      { id: 'env_uat', name: 'UAT', color: '#f59e0b', variables: [{ id: generateUUID(), key: 'baseUrl', value: 'https://uat.example.com', type: 'default', enabled: true }], updatedAt: Date.now() },
      { id: 'env_prod', name: 'PROD', color: '#ef4444', variables: [{ id: generateUUID(), key: 'baseUrl', value: 'https://api.example.com', type: 'default', enabled: true }], updatedAt: Date.now() }
    ];
  }

  private loadActiveEnvId(): string | null {
    if (!this.isBrowser) return null;
    try {
      return localStorage.getItem(ACTIVE_ENV_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  private persist(envs: ApiEnvironment[]): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(ENV_LIST_STORAGE_KEY, JSON.stringify(envs));
    } catch {}
  }

  setActiveEnvironment(id: string | null): void {
    const clean = id || null;
    this.activeEnvironmentId.set(clean);
    if (this.isBrowser) {
      try {
        if (clean) localStorage.setItem(ACTIVE_ENV_STORAGE_KEY, clean);
        else localStorage.removeItem(ACTIVE_ENV_STORAGE_KEY);
      } catch {}
    }
  }

  selectEnvironmentByName(name: string): ApiEnvironment | null {
    const target = (name || '').trim().toLowerCase();
    if (!target || target === 'none' || target === 'off') {
      this.setActiveEnvironment(null);
      return null;
    }
    const found = this.environments().find(e => e.name.trim().toLowerCase() === target || e.id.toLowerCase() === target);
    if (found) {
      this.setActiveEnvironment(found.id);
      return found;
    }
    return null;
  }

  getActiveVariable(key: string): string | undefined {
    const env = this.activeEnvironment();
    if (!env || !key) return undefined;
    const clean = key.trim().toLowerCase();
    const match = env.variables.find(v => v.enabled && v.key.trim().toLowerCase() === clean);
    return match ? match.value : undefined;
  }

  setActiveVariable(key: string, value: string): void {
    const cleanKey = (key || '').trim();
    if (!cleanKey) return;
    let env = this.activeEnvironment();
    if (!env) {
      env = this.environments()[0] || this.createEnvironment('DEV', '#10b981');
      this.setActiveEnvironment(env.id);
    }
    const lower = cleanKey.toLowerCase();
    const idx = env.variables.findIndex(v => v.key.trim().toLowerCase() === lower);
    const nextVars = [...env.variables];
    if (idx !== -1) {
      nextVars[idx] = { ...nextVars[idx], value: String(value ?? ''), enabled: true };
    } else {
      nextVars.push({ id: generateUUID(), key: cleanKey, value: String(value ?? ''), type: 'default', enabled: true });
    }
    this.updateEnvironment({ ...env, variables: nextVars });
  }

  unsetActiveVariable(key: string): void {
    const env = this.activeEnvironment();
    if (!env || !key) return;
    const lower = key.trim().toLowerCase();
    this.updateEnvironment({
      ...env,
      variables: env.variables.filter(v => v.key.trim().toLowerCase() !== lower)
    });
  }

  createEnvironment(name: string, color = '#3b82f6'): ApiEnvironment {
    const env: ApiEnvironment = {
      id: `env_${generateUUID().slice(0, 8)}`,
      name: name.trim() || 'New Environment',
      color,
      variables: [{ id: generateUUID(), key: '', value: '', type: 'default', enabled: true }],
      updatedAt: Date.now()
    };
    this.environments.update(list => {
      const next = [...list, env];
      this.persist(next);
      return next;
    });
    this.setActiveEnvironment(env.id);
    return env;
  }

  duplicateEnvironment(envId: string): ApiEnvironment | null {
    const src = this.environments().find(e => e.id === envId);
    if (!src) return null;
    const copy: ApiEnvironment = {
      id: `env_${generateUUID().slice(0, 8)}`,
      name: `${src.name} (Copy)`,
      color: src.color,
      variables: src.variables.map(v => ({ ...v, id: generateUUID() })),
      updatedAt: Date.now()
    };
    this.environments.update(list => {
      const next = [...list, copy];
      this.persist(next);
      return next;
    });
    return copy;
  }

  updateEnvironment(env: ApiEnvironment): void {
    const updated: ApiEnvironment = { ...env, updatedAt: Date.now() };
    this.environments.update(list => {
      const next = list.map(e => (e.id === updated.id ? updated : e));
      this.persist(next);
      return next;
    });
  }

  deleteEnvironment(envId: string): void {
    this.environments.update(list => {
      const next = list.filter(e => e.id !== envId);
      this.persist(next);
      return next;
    });
    if (this.activeEnvironmentId() === envId) {
      this.setActiveEnvironment(null);
    }
  }

  importPostmanEnvironment(rawJson: string): ApiEnvironment {
    const data = JSON.parse(rawJson);
    const name = String(data?.name || 'Imported Environment').trim();
    const values = Array.isArray(data?.values) ? data.values : [];
    const env: ApiEnvironment = {
      id: `env_${generateUUID().slice(0, 8)}`,
      name,
      color: '#8b5cf6',
      variables: values.map((v: any) => ({
        id: generateUUID(),
        key: String(v?.key || ''),
        value: String(v?.value ?? ''),
        type: v?.type === 'secret' ? 'secret' : 'default',
        enabled: v?.enabled !== false
      })),
      updatedAt: Date.now()
    };
    this.environments.update(list => {
      const next = [...list, env];
      this.persist(next);
      return next;
    });
    this.setActiveEnvironment(env.id);
    return env;
  }

  exportPostmanEnvironment(envId: string): Record<string, any> | null {
    const env = this.environments().find(e => e.id === envId);
    if (!env) return null;
    return {
      id: env.id,
      name: env.name,
      values: env.variables
        .filter(v => v.key.trim() !== '')
        .map(v => ({
          key: v.key,
          value: v.value,
          type: v.type,
          enabled: v.enabled
        })),
      _postman_variable_scope: 'environment',
      _postman_exported_at: new Date().toISOString(),
      _postman_exported_using: 'OnSteroid'
    };
  }
}
