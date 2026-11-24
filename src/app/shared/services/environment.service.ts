import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VariableService } from './variable.service';
import { SubscriptionService } from './subscription.service';
import { NotificationService } from './notification.service';
import { VariableSource } from '../../interfaces/services/IVariableService';
import { generateUUID } from '../utils/uuid.util';

export interface EnvironmentVariableItem {
  id: string;
  key: string;
  value: string;
  type: 'default' | 'secret';
  enabled: boolean;
  source?: VariableSource;
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
  private subscription = inject(SubscriptionService);
  private notification = inject(NotificationService);

  readonly isEnvironmentFeatureEnabled = computed<boolean>(() => this.subscription.isProOrHigher());

  environments = signal<ApiEnvironment[]>(this.loadEnvironments());
  activeEnvironmentId = signal<string | null>(this.loadActiveEnvId());

  activeEnvironment = computed<ApiEnvironment | null>(() => {
    if (!this.isEnvironmentFeatureEnabled()) return null;
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
    if (id && !this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return;
    }
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
    if (!this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return null;
    }
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

  setActiveVariable(key: string, value: string, source?: VariableSource): void {
    const cleanKey = (key || '').trim();
    if (!cleanKey) return;
    if (!this.isEnvironmentFeatureEnabled()) return;
    let env = this.activeEnvironment();
    if (!env) {
      env = this.environments()[0] || this.createEnvironment('DEV', '#10b981');
      this.setActiveEnvironment(env.id);
    }
    const lower = cleanKey.toLowerCase();
    const nextEnvs = this.environments().map(e => {
      const idx = e.variables.findIndex(v => v.key.trim().toLowerCase() === lower);
      if (e.id === env!.id) {
        const nextVars = [...e.variables];
        if (idx !== -1) {
          nextVars[idx] = {
            ...nextVars[idx],
            value: String(value ?? ''),
            enabled: true,
            source: source !== undefined ? source : nextVars[idx].source
          };
        } else {
          nextVars.push({
            id: generateUUID(),
            key: cleanKey,
            value: String(value ?? ''),
            type: 'default',
            enabled: true,
            source
          });
        }
        return { ...e, variables: nextVars, updatedAt: Date.now() };
      }
      // Postman-style shared schema: ensure key exists in all other environments without overwriting their contextual values
      if (idx === -1) {
        return {
          ...e,
          variables: [
            ...e.variables,
            { id: generateUUID(), key: cleanKey, value: '', type: 'default' as const, enabled: false }
          ],
          updatedAt: Date.now()
        };
      }
      return e;
    });
    this.environments.set(nextEnvs);
    this.persist(nextEnvs);
  }

  ensureKeyAcrossEnvironments(key: string, activeEnvValue?: string, source?: VariableSource): void {
    const cleanKey = (key || '').trim();
    if (!cleanKey || !this.isEnvironmentFeatureEnabled()) return;
    const lower = cleanKey.toLowerCase();
    const activeId = this.activeEnvironmentId();
    let changed = false;
    const nextEnvs = this.environments().map(e => {
      const idx = e.variables.findIndex(v => v.key.trim().toLowerCase() === lower);
      if (idx === -1) {
        changed = true;
        const isActiveTarget = e.id === activeId && activeEnvValue !== undefined;
        return {
          ...e,
          variables: [
            ...e.variables,
            {
              id: generateUUID(),
              key: cleanKey,
              value: isActiveTarget ? String(activeEnvValue) : '',
              type: 'default' as const,
              enabled: isActiveTarget,
              ...(isActiveTarget && source ? { source } : {})
            }
          ],
          updatedAt: Date.now()
        };
      }
      return e;
    });
    if (changed) {
      this.environments.set(nextEnvs);
      this.persist(nextEnvs);
    }
  }

  removeKeyAcrossEnvironments(key: string): void {
    const cleanKey = (key || '').trim().toLowerCase();
    if (!cleanKey || !this.isEnvironmentFeatureEnabled()) return;
    const nextEnvs = this.environments().map(e => ({
      ...e,
      variables: e.variables.filter(v => v.key.trim().toLowerCase() !== cleanKey),
      updatedAt: Date.now()
    }));
    this.environments.set(nextEnvs);
    this.persist(nextEnvs);
  }

  copyVariablesToEnvironment(
    items: Array<{ key: string; value: string; type?: 'default' | 'secret'; source?: VariableSource }>,
    targetEnvId: string | '__all__'
  ): number {
    if (!this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return 0;
    }
    const valid = items.filter(it => (it.key || '').trim() !== '');
    if (valid.length === 0) return 0;

    let copiedCount = 0;
    const nextEnvs = this.environments().map(e => {
      if (targetEnvId !== '__all__' && e.id !== targetEnvId) return e;
      const nextVars = [...e.variables];
      for (const item of valid) {
        const cleanKey = item.key.trim();
        const lower = cleanKey.toLowerCase();
        const idx = nextVars.findIndex(v => v.key.trim().toLowerCase() === lower);
        if (idx !== -1) {
          nextVars[idx] = {
            ...nextVars[idx],
            value: String(item.value ?? ''),
            type: item.type || nextVars[idx].type,
            enabled: true,
            source: item.source ?? nextVars[idx].source
          };
        } else {
          nextVars.push({
            id: generateUUID(),
            key: cleanKey,
            value: String(item.value ?? ''),
            type: item.type || 'default',
            enabled: true,
            source: item.source
          });
        }
      }
      copiedCount += valid.length;
      return { ...e, variables: nextVars, updatedAt: Date.now() };
    });

    this.environments.set(nextEnvs);
    this.persist(nextEnvs);
    return copiedCount;
  }

  syncActiveEnvVariablesFromResponse(
    tabId: string,
    responseBody: any,
    responseHeaders: any[],
    requestState?: { id?: string; url?: string; name?: string },
    resolvedUrl?: string
  ): void {
    const env = this.activeEnvironment();
    if (!env || (responseBody === undefined && (!responseHeaders || responseHeaders.length === 0))) return;

    let changed = false;
    const nextVars = env.variables.map(item => {
      const src = item.source;
      if (!src || src.type !== 'response' || !item.enabled) return item;
      const matchesTab =
        (src.tabId && src.tabId === tabId) ||
        (src.requestId && requestState?.id && src.requestId === requestState.id) ||
        (src.requestUrl && (requestState?.url === src.requestUrl || resolvedUrl === src.requestUrl));
      if (!matchesTab) return item;

      const prop = src.propertyKey?.trim();
      let newVal: any = undefined;
      if (prop && responseBody !== undefined && responseBody !== null) {
        newVal = this.variableService.extractValue(responseBody, prop);
      } else if (!prop && responseBody !== undefined && responseBody !== null) {
        newVal = typeof responseBody === 'object' ? JSON.stringify(responseBody) : String(responseBody);
      }
      if ((newVal === undefined || newVal === null) && prop && Array.isArray(responseHeaders)) {
        const hMatch = responseHeaders.find((h: any) => h.key?.toLowerCase() === prop.toLowerCase());
        if (hMatch && hMatch.value !== undefined) newVal = hMatch.value;
      }
      if (newVal !== undefined && newVal !== null) {
        const strVal = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal);
        if (strVal !== item.value) {
          changed = true;
          return { ...item, value: strVal };
        }
      }
      return item;
    });

    if (changed) {
      this.updateEnvironment({ ...env, variables: nextVars });
    }
  }

  renameVariableKeyAcrossEnvironments(oldKey: string, newKey: string): void {
    const cleanOld = (oldKey || '').trim().toLowerCase();
    const cleanNew = (newKey || '').trim();
    if (!cleanOld || !cleanNew || !this.isEnvironmentFeatureEnabled()) return;
    if (cleanOld === cleanNew.toLowerCase()) {
      // Case-only key rename
      const nextEnvs = this.environments().map(e => ({
        ...e,
        variables: e.variables.map(v => v.key.trim().toLowerCase() === cleanOld ? { ...v, key: cleanNew } : v),
        updatedAt: Date.now()
      }));
      this.environments.set(nextEnvs);
      this.persist(nextEnvs);
      return;
    }
    const nextEnvs = this.environments().map(e => {
      const hasNew = e.variables.some(v => v.key.trim().toLowerCase() === cleanNew.toLowerCase());
      const nextVars = e.variables
        .filter(v => !(hasNew && v.key.trim().toLowerCase() === cleanOld))
        .map(v => v.key.trim().toLowerCase() === cleanOld ? { ...v, key: cleanNew } : v);
      return { ...e, variables: nextVars, updatedAt: Date.now() };
    });
    this.environments.set(nextEnvs);
    this.persist(nextEnvs);
  }

  unsetActiveVariable(key: string): void {
    const env = this.activeEnvironment();
    if (!env || !key || !this.isEnvironmentFeatureEnabled()) return;
    const lower = key.trim().toLowerCase();
    this.updateEnvironment({
      ...env,
      variables: env.variables.map(v =>
        v.key.trim().toLowerCase() === lower ? { ...v, value: '' } : v
      )
    });
  }

  createEnvironment(name: string, color = '#3b82f6'): ApiEnvironment | null {
    if (!this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return null;
    }
    const sharedKeyMap = new Map<string, string>();
    for (const v of this.variableService.variables()) {
      const clean = (v.key || '').trim();
      if (clean && !clean.startsWith('__') && !sharedKeyMap.has(clean.toLowerCase())) {
        sharedKeyMap.set(clean.toLowerCase(), clean);
      }
    }
    for (const existingEnv of this.environments()) {
      for (const v of existingEnv.variables) {
        const clean = (v.key || '').trim();
        if (clean && !sharedKeyMap.has(clean.toLowerCase())) {
          sharedKeyMap.set(clean.toLowerCase(), clean);
        }
      }
    }
    const seededVars: EnvironmentVariableItem[] = Array.from(sharedKeyMap.values()).map(k => ({
      id: generateUUID(),
      key: k,
      value: '',
      type: 'default',
      enabled: false
    }));
    if (seededVars.length === 0) {
      seededVars.push({ id: generateUUID(), key: '', value: '', type: 'default', enabled: true });
    }
    const env: ApiEnvironment = {
      id: `env_${generateUUID().slice(0, 8)}`,
      name: name.trim() || 'New Environment',
      color,
      variables: seededVars,
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
    if (!this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return null;
    }
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
    if (!this.isEnvironmentFeatureEnabled()) return;
    const updated: ApiEnvironment = { ...env, updatedAt: Date.now() };
    this.environments.update(list => {
      const next = list.map(e => (e.id === updated.id ? updated : e));
      this.persist(next);
      return next;
    });
  }

  deleteEnvironment(envId: string): void {
    if (!this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return;
    }
    this.environments.update(list => {
      const next = list.filter(e => e.id !== envId);
      this.persist(next);
      return next;
    });
    if (this.activeEnvironmentId() === envId) {
      this.setActiveEnvironment(null);
    }
  }

  importPostmanEnvironment(rawJson: string): ApiEnvironment | null {
    if (!this.isEnvironmentFeatureEnabled()) {
      this.notification.notify('Environments are available on Pro & Enterprise plans.', 'warning');
      return null;
    }
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
    for (const v of env.variables) {
      if ((v.key || '').trim()) {
        this.ensureKeyAcrossEnvironments(v.key);
      }
    }
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
