import { Injectable, signal, computed, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface KeyValue {
    enabled: boolean;
    key: string;
    value: string;
}

export interface FormDataRow {
    enabled: boolean;
    key: string;
    value: string;
    type: 'text' | 'file';
}

export interface AuthState {
    type: 'none' | 'bearer' | 'basic';
    token: string;
}

export interface ScriptsState {
    preRequest: string;
    postResponse: string;
    preRequestConsole: string;
    postResponseConsole: string;
    encryptionConsole: string;
    testScript: string;
    testScriptEnabled: boolean;
}

export interface CookieRow {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: string;
}

export interface TestResult {
    name: string;
    passed: boolean;
}

export interface EncryptionState {
    algorithm: 'AES-256' | 'RSA-2048' | 'none';
    key: string;
    autoEncryptBody: boolean;
    autoEncryptHeaders: boolean;
    channelName: string;
    encryptedHeaders: string[];
    encryptedBodyPaths: string[];
    script: string;
}

export interface SettingsState {
    followRedirects: boolean;
    verifySsl: boolean;
    enableCookies: boolean;
    bypassCors: boolean;
}

export interface RequestState {
    id: string;
    url: string;
    method: string;
    name: string;
    isDirty: boolean;
    isLoading: boolean;
    autoAuthEnabled?: boolean;
    // Payload type tabs
    payloadType: string;
    params: KeyValue[];
    headers: KeyValue[];
    auth: AuthState;
    scripts: ScriptsState;
    encryption: EncryptionState;
    settings: SettingsState;
    // Body
    bodyType: string;
    rawType: string;
    rawBody: string; // Keep for compatibility or current selection
    rawBodyJson: string;
    rawBodyXml: string;
    formData: FormDataRow[];
    requestBody: unknown;
    // Response
    responseBody: unknown;
    responseStatus: number | null;
    responseTime: number | null;
    responseSize: number | null;
    responseCookies: CookieRow[];
    responseHeaders: KeyValue[];
    testResults: TestResult[];
    editorScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }>;
}


export interface Capsule {
    id: string;
    name: string;
    createdAt: number;
}

@Injectable({
    providedIn: 'root',
})
export class TabStateService {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);
    private states = signal<Map<string, RequestState>>(new Map());
    private openTabIds = signal<string[]>([]);

    getState(id: string): RequestState | undefined {
        return this.states().get(id);
    }
    activeTabId = signal<string | null>(null);
    activeCapsuleName = signal<string>('My Capsule');
    activeCapsuleId = signal<string>('1');
    autoAuthEnabled = signal<'off' | 'individual' | 'global'>('off');
    autoAuthEndpointId = signal<string | null>(null);
    isCapsuleLoading = signal<boolean>(false);
    isSaving = signal<boolean>(false);

    private historyStack = new Map<string, { past: Partial<RequestState>[], future: Partial<RequestState>[] }>();

    // Shared capsule list (drives both workspace sidebar and Capsules page)
    capsules = signal<Capsule[]>([
        { id: '1', name: 'My Capsule', createdAt: Date.now() - 10000 },
        { id: '2', name: 'API Project A', createdAt: Date.now() - 5000 },
        { id: '3', name: 'Personal Sandbox', createdAt: Date.now() }
    ]);

    // In-memory "database" of saved requests
    savedCapsules = signal<RequestState[]>([]);

    // Reactive list of open tabs (mirrors the horizontal tab strip)
    openTabs = computed<RequestState[]>(() => {
        const ids = this.openTabIds();
        const stateMap = this.states();
        return ids.map(id => stateMap.get(id)).filter((s): s is RequestState => Boolean(s));
    });

    activeTabState = computed(() => {
        const id = this.activeTabId();
        return id ? this.states().get(id) || this.getDefaultState(id) : null;
    });

    constructor() {
        if (this.isBrowser) {
            this.loadFromStorage();
        }

        // Persist to storage whenever states change
        effect(() => {
            if (this.isBrowser) {
                const currentStates = Array.from(this.states().entries());
                localStorage.setItem('onsteroids_states', JSON.stringify(currentStates));
                localStorage.setItem('onsteroids_active_tab', this.activeTabId() || '');
                localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(this.openTabIds()));
                localStorage.setItem('autoAuthEnabled', String(this.autoAuthEnabled()));
                localStorage.setItem('autoAuthEndpointId', this.autoAuthEndpointId() || '');
            }
        });

        if (this.states().size === 0) {
            this.setActiveTab('1');
        }
    }

    private loadFromStorage() {
        if (!this.isBrowser) return;
        const savedStates = localStorage.getItem('onsteroids_states');
        const activeTabId = localStorage.getItem('onsteroids_active_tab');
        const savedOpenTabIds = localStorage.getItem('onsteroids_open_tab_ids');

        if (savedStates) {
            try {
                const parsed = JSON.parse(savedStates);
                this.states.set(new Map(parsed));
            } catch (e) {
                console.error('Failed to load states from storage', e);
            }
        }

        if (savedOpenTabIds) {
            try {
                const parsed = JSON.parse(savedOpenTabIds);
                if (Array.isArray(parsed)) {
                    this.openTabIds.set(parsed.filter(item => typeof item === 'string'));
                }
            } catch (e) {
                console.error('Failed to load open tabs from storage', e);
            }
        }

        if (this.openTabIds().length === 0 && this.states().size > 0) {
            this.openTabIds.set(Array.from(this.states().keys()));
        }

        if (activeTabId) {
            this.activeTabId.set(activeTabId);
        }

        const savedAutoAuth = localStorage.getItem('autoAuthEnabled');
        const savedAutoAuthId = localStorage.getItem('autoAuthEndpointId');
        if (savedAutoAuth) {
            if (savedAutoAuth === 'true') {
                this.autoAuthEnabled.set('individual');
            } else if (savedAutoAuth === 'false') {
                this.autoAuthEnabled.set('off');
            } else {
                this.autoAuthEnabled.set(savedAutoAuth as any);
            }
        }
        if (savedAutoAuthId) {
            this.autoAuthEndpointId.set(savedAutoAuthId);
        }
    }

    setActiveTab(id: string) {
        if (!this.states().has(id)) {
            this.states.update(map => {
                map.set(id, this.getDefaultState(id));
                return new Map(map);
            });
        }

        if (!this.openTabIds().includes(id)) {
            this.openTabIds.update(ids => [...ids, id]);
        }

        this.activeTabId.set(id);
    }

    getAllOpenTabs(): RequestState[] {
        return this.openTabIds()
            .map(id => this.states().get(id))
            .filter((state): state is RequestState => Boolean(state));
    }

    closeAllTabs() {
        this.openTabIds.set([]);
        this.activeTabId.set(null);
    }

    setActiveCapsuleName(name: string) {
        this.activeCapsuleName.set(name);
    }

    switchCapsule(capsule: { id: string; name: string }) {
        this.activeCapsuleId.set(capsule.id);
        this.activeCapsuleName.set(capsule.name);
    }

    updateState(id: string, partialState: Partial<RequestState>, recordHistory = true) {
        this.states.update(map => {
            const currentState = map.get(id) || this.getDefaultState(id);

            const ignorableKeys = ['isLoading', 'responseBody', 'responseStatus', 'responseTime', 'responseSize', 'responseCookies', 'responseHeaders', 'testResults', 'editorScrollPositions', 'isDirty'];
            const isSignificantChange = Object.keys(partialState).some(k => !ignorableKeys.includes(k));

            if (recordHistory && isSignificantChange) {
                const pastChange: Partial<RequestState> = {};
                for (const key in partialState) {
                    if (!ignorableKeys.includes(key)) {
                        pastChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
                    }
                }
                
                if (Object.keys(pastChange).length > 0) {
                    const stack = this.historyStack.get(id) || { past: [], future: [] };
                    stack.past.push(pastChange);
                    if (stack.past.length > 50) stack.past.shift();
                    stack.future = [];
                    this.historyStack.set(id, stack);
                }
            }

            map.set(id, { ...currentState, ...partialState });
            return new Map(map);
        });
    }

    undo() {
        const id = this.activeTabId();
        if (!id) return;
        const stack = this.historyStack.get(id);
        if (!stack || stack.past.length === 0) return;

        const pastChange = stack.past.pop()!;
        const currentState = this.states().get(id)!;
        
        const futureChange: Partial<RequestState> = {};
        for (const key in pastChange) {
            futureChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
        }
        stack.future.push(futureChange);
        
        this.updateState(id, pastChange, false);
    }

    redo() {
        const id = this.activeTabId();
        if (!id) return;
        const stack = this.historyStack.get(id);
        if (!stack || stack.future.length === 0) return;

        const futureChange = stack.future.pop()!;
        const currentState = this.states().get(id)!;
        
        const pastChange: Partial<RequestState> = {};
        for (const key in futureChange) {
            pastChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
        }
        stack.past.push(pastChange);
        
        this.updateState(id, futureChange, false);
    }

    addOpenTab(state: RequestState) {
        this.states.update(map => {
            const next = new Map(map);
            next.set(state.id, state);
            return next;
        });

        if (!this.openTabIds().includes(state.id)) {
            this.openTabIds.update(ids => [...ids, state.id]);
        }
    }

    closeTab(id: string) {
        this.openTabIds.update(ids => ids.filter(tabId => tabId !== id));
        this.states.update(map => {
            const next = new Map(map);
            next.delete(id);
            return next;
        });
        this.historyStack.delete(id);
    }

    async fetchCapsuleData(collectionName: string) {
        this.isCapsuleLoading.set(true);
        this.states.update(map => {
            const newMap = new Map(map);
            for (let [id, state] of newMap.entries()) {
                const dummyData = this.generateDummyData(id);
                newMap.set(id, { ...state, ...dummyData, isLoading: false });
            }
            return newMap;
        });

        this.isCapsuleLoading.set(false);
    }

    async fetchTabData(id: string) {
        this.updateState(id, { isLoading: true });
        const dummyData = this.generateDummyData(id);
        this.updateState(id, { ...dummyData, isLoading: false });
    }

    async saveToCapsule(id: string): Promise<void> {
        this.isSaving.set(true);

        const currentState = this.states().get(id);
        if (currentState) {
            this.savedCapsules.update(col => {
                const idx = col.findIndex(r => r.id === id);
                if (idx >= 0) {
                    const updated = [...col];
                    updated[idx] = { ...currentState, isDirty: false };
                    return updated;
                } else {
                    return [...col, { ...currentState, isDirty: false }];
                }
            });
            // Mark tab as clean after save
            this.updateState(id, { isDirty: false });
        }

        this.isSaving.set(false);
    }

    duplicateTab(id: string): string | null {
        const source = this.states().get(id);
        if (!source) return null;

        const newId = this.createId();
        const duplicate: RequestState = {
            ...structuredClone(source),
            id: newId,
            name: `${source.name} Copy`,
            isDirty: true,
            isLoading: false,
        };

        this.states.update(map => {
            const next = new Map(map);
            next.set(newId, duplicate);
            return next;
        });

        this.openTabIds.update(ids => {
            const sourceIndex = ids.indexOf(id);
            if (sourceIndex === -1) {
                return [...ids, newId];
            }

            const next = [...ids];
            next.splice(sourceIndex + 1, 0, newId);
            return next;
        });

        this.activeTabId.set(newId);
        return newId;
    }

    reorderOpenTabs(previousIndex: number, currentIndex: number) {
        this.openTabIds.update(ids => {
            if (
                previousIndex === currentIndex ||
                previousIndex < 0 ||
                currentIndex < 0 ||
                previousIndex >= ids.length ||
                currentIndex >= ids.length
            ) {
                return ids;
            }

            const next = [...ids];
            const [movedId] = next.splice(previousIndex, 1);
            next.splice(currentIndex, 0, movedId);
            return next;
        });
    }

    getDefaultState(id: string): RequestState {
        return {
            id,
            url: '',
            method: 'GET',
            name: 'New Request',
            isDirty: false,
            isLoading: false,
            autoAuthEnabled: false,
            payloadType: 'params',
            params: [{ enabled: true, key: '', value: '' }],
            headers: [
                { enabled: true, key: 'Accept', value: 'application/json' },
                { enabled: true, key: '', value: '' }
            ],
            auth: { type: 'none', token: '' },
            scripts: {
                preRequest: 'function preScript(headers, body, params){\n    //only code written within this code block will be executed\n}',
                postResponse: 'function postScript(responseHeader, responseBody){\n    //only code written within this code block will be executed\n}',
                preRequestConsole: '',
                postResponseConsole: '',
                encryptionConsole: '',
                testScript: 'function testScript(responseStatus, responseTime, responseBody){\n    let passed = true;\n    //Add test assertions here\n    return passed;\n}',
                testScriptEnabled: false
            },
            encryption: {
                algorithm: 'none',
                key: '',
                autoEncryptBody: false,
                autoEncryptHeaders: false,
                channelName: '',
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: 'async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {\n    function getNestedValue(obj, path) {\n        return path.split(".").reduce((acc, part) => acc && acc[part], obj);\n    }\n    function setNestedValue(obj, path, value) {\n        const parts = path.split(".");\n        const last = parts.pop();\n        const target = parts.reduce((acc, part) => {\n            if (!acc[part]) acc[part] = {};\n            return acc[part];\n        }, obj);\n        if (target) target[last] = value;\n    }\n    function getPrimitivePaths(obj, currentPath = "") {\n        let paths = [];\n        for (let key in obj) {\n            if (obj.hasOwnProperty(key)) {\n                const path = currentPath ? `${currentPath}.${key}` : key;\n                if (obj[key] !== null && typeof obj[key] === "object") {\n                    paths = paths.concat(getPrimitivePaths(obj[key], path));\n                } else {\n                    paths.push(path);\n                }\n            }\n        }\n        return paths;\n    }\n    const parameters = {};\n    const shouldEncryptAllHeaders = typeof autoEncryptHeaders !== "undefined" ? autoEncryptHeaders : false;\n    const encHeadersList = encryptedHeaders || [];\n    for (let h of headers) {\n        if (h.enabled && h.key) {\n            if (shouldEncryptAllHeaders || encHeadersList.includes(h.key)) {\n                parameters[h.key] = h.value;\n            }\n        }\n    }\n    let bodyObj = null;\n    if (body) {\n        try {\n            bodyObj = JSON.parse(body);\n        } catch (e) {}\n    }\n    if (bodyObj) {\n        const shouldEncryptAllBody = typeof autoEncryptBody !== "undefined" ? autoEncryptBody : false;\n        const encBodyPathsList = encryptedBodyPaths || [];\n        if (shouldEncryptAllBody) {\n            const allPaths = getPrimitivePaths(bodyObj);\n            for (let path of allPaths) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        } else {\n            for (let path of encBodyPathsList) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        }\n    }\n    if (Object.keys(parameters).length > 0) {\n        console.log("Sending the following parameters for encryption:", JSON.stringify(parameters, null, 2));\n        try {\n            const chName = typeof channelName !== "undefined" ? channelName : "Default Channel";\n            const response = await fetch("https://localhost:7131/api/v1/auth/encrypt", {\n                method: "POST",\n                headers: {\n                    "Content-Type": "application/json"\n                },\n                body: JSON.stringify({\n                    channelName: chName,\n                    parameters: parameters\n                })\n            });\n            if (response.ok) {\n                const result = await response.json();\n                console.log("Encryption successful. Encrypted values received:", JSON.stringify(result, null, 2));\n                const encryptedParams = result.parameters || result;\n                for (let h of headers) {\n                    if (h.key && encryptedParams[h.key] !== undefined) {\n                        h.value = String(encryptedParams[h.key]);\n                    }\n                }\n                if (bodyObj) {\n                    for (let key in encryptedParams) {\n                        if (encryptedParams.hasOwnProperty(key)) {\n                            if (key.includes(".") || getNestedValue(bodyObj, key) !== undefined) {\n                                setNestedValue(bodyObj, key, encryptedParams[key]);\n                            }\n                        }\n                    }\n                    body = JSON.stringify(bodyObj, null, 2);\n                }\n            } else {\n                console.log("Encryption failed. Status:", response.status);\n            }\n        } catch (error) {\n            console.error("Error during payload encryption:", error);\n        }\n    } else {\n        console.log("No parameters were selected for encryption.");\n    }\n    return body;\n}'
            },
            settings: { followRedirects: true, verifySsl: true, enableCookies: true, bypassCors: true },
            bodyType: 'none',
            rawType: 'JSON',
            rawBody: '{}',
            rawBodyJson: '{}',
            rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>',
            formData: [{ enabled: true, key: '', value: '', type: 'text' }],
            requestBody: {},
            responseBody: null,
            responseStatus: null,
            responseTime: null,
            responseSize: null,
            responseCookies: [],
            responseHeaders: [],
            testResults: [],
            editorScrollPositions: {},
        };
    }

    private generateDummyData(id: string): Partial<RequestState> {
        const methods = ['GET', 'POST', 'PUT', 'DELETE'];
        const method = methods[Math.floor(Math.random() * methods.length)];
        const entries = [
            {
                url: 'https://api.acegeld.runasp.net/login',
                name: 'Login',
                params: [
                    { enabled: true, key: 'redirect', value: 'dashboard' },
                    { enabled: false, key: 'lang', value: 'en' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: { success: true, token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature', expiresAt: '2026-12-31', user: { id: 1, email: 'john@example.com' } },
                responseStatus: 200,
                responseTime: 143,
                responseSize: 512,
                responseCookies: [
                    { name: 'session_id', value: 'abc123xyz', domain: 'acegeld.runasp.net', path: '/', expires: '2026-12-31T00:00:00Z' },
                ],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json' },
                    { enabled: true, key: 'X-Request-Id', value: 'req-abc-123' },
                    { enabled: true, key: 'Cache-Control', value: 'no-store' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: true },
                    { name: 'Response has token', passed: true },
                    { name: 'Token is not empty', passed: true },
                ],
                auth: { type: 'none' as const, token: '', username: '', password: '' },
                formData: [],
                rawBody: JSON.stringify({ email: 'john@example.com', password: 'secret' }, null, 2),
            },
            {
                url: 'https://api.example.com/v1/users',
                name: 'Get Users',
                params: [
                    { enabled: true, key: 'page', value: '1' },
                    { enabled: true, key: 'limit', value: '20' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: { data: [{ id: 1, name: 'Alice', role: 'admin' }, { id: 2, name: 'Bob', role: 'user' }], total: 2, page: 1 },
                responseStatus: 200,
                responseTime: 88,
                responseSize: 304,
                responseCookies: [],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json' },
                    { enabled: true, key: 'X-Total-Count', value: '200' },
                    { enabled: true, key: 'X-Page', value: '1' },
                    { enabled: true, key: 'Vary', value: 'Accept-Encoding' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: true },
                    { name: 'Response has data array', passed: true },
                    { name: 'Pagination fields present', passed: false },
                ],
                auth: { type: 'bearer' as const, token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig', username: '', password: '' },
                formData: [],
                rawBody: '{}',
            },
            {
                url: 'https://api.shop.dev/products/123',
                name: 'Get Product',
                params: [
                    { enabled: true, key: 'include', value: 'images,variants' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: { product: { id: 'p1', name: 'Wireless Headphones', price: 99.99, currency: 'USD', stock: 42 } },
                responseStatus: 200,
                responseTime: 264,
                responseSize: 820,
                responseCookies: [
                    { name: 'cart_id', value: 'cart-9k2j', domain: 'api.shop.dev', path: '/', expires: 'Session' },
                ],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json' },
                    { enabled: true, key: 'ETag', value: '"abc123"' },
                    { enabled: true, key: 'Cache-Control', value: 'max-age=3600' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: true },
                    { name: 'Product has price field', passed: true },
                    { name: 'Price is positive', passed: true },
                    { name: 'Stock > 0', passed: false },
                ],
                auth: { type: 'none' as const, token: '', username: '', password: '' },
                formData: [
                    { enabled: true, key: 'thumbnail', value: '', type: 'file' as const },
                    { enabled: true, key: 'alt_text', value: 'Headphones front view', type: 'text' as const },
                    { enabled: true, key: '', value: '', type: 'text' as const },
                ],
                rawBody: '{}',
            },
            {
                url: 'https://jsonplaceholder.typicode.com/posts',
                name: 'Get Posts',
                params: [
                    { enabled: true, key: '_limit', value: '10' },
                    { enabled: false, key: 'userId', value: '1' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: [
                    { id: 1, title: 'Hello World', body: 'Lorem ipsum dolor sit amet', userId: 1 },
                    { id: 2, title: 'Angular Signals', body: 'Signals revolutionize reactivity in Angular', userId: 1 },
                ],
                responseStatus: 404,
                responseTime: 512,
                responseSize: 2048,
                responseCookies: [],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json; charset=utf-8' },
                    { enabled: true, key: 'X-Powered-By', value: 'Express' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: false },
                    { name: 'Response is array', passed: true },
                    { name: 'Array is not empty', passed: true },
                ],
                auth: { type: 'none' as const, token: '', username: '', password: '' },
                formData: [],
                rawBody: JSON.stringify({ title: 'New Post', body: 'Post content here', userId: 1 }, null, 2),
            },
        ];

        const entry = entries[parseInt(id, 10) % entries.length];

        const rawBody = entry.rawBody || '{}';
        return {
            url: entry.url,
            method,
            name: entry.name,
            params: entry.params,
            headers: [
                { enabled: true, key: 'Accept', value: 'application/json' },
                { enabled: true, key: 'Content-Type', value: 'application/json' },
                { enabled: method !== 'GET', key: 'Authorization', value: entry.auth.type === 'bearer' ? `Bearer ${entry.auth.token}` : '' },
                { enabled: true, key: '', value: '' },
            ],
            auth: entry.auth,
            formData: entry.formData ?? [{ enabled: true, key: '', value: '', type: 'text' }],
            rawBody: rawBody,
            rawBodyJson: rawBody,
            rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>',
            requestBody: method === 'POST' || method === 'PUT' ? JSON.parse(rawBody || '{}') : {},
            responseBody: entry.responseBody,
            responseStatus: entry.responseStatus,
            responseTime: entry.responseTime,
            responseSize: entry.responseSize,
            responseCookies: entry.responseCookies,
            responseHeaders: entry.responseHeaders,
            testResults: entry.testResults,
            editorScrollPositions: {},
            isDirty: Math.random() > 0.5,
            payloadType: 'params',
            bodyType: method === 'POST' || method === 'PUT' ? 'raw' : 'none',
            rawType: 'JSON',
            scripts: {
                preRequest: method === 'POST' ? `function preScript(headers, body, params){\n    const timestamp = Date.now();\n    headers.push({ enabled: true, key: 'X-Timestamp', value: String(timestamp) });\n}` : 'function preScript(headers, body, params){\n    //only code written within this code block will be executed\n}',
                postResponse: `function postScript(responseHeader, responseBody){\n    //only code written within this code block will be executed\n}`,
                preRequestConsole: method === 'POST' ? 'Setting variable timestamp to 1710587421932\nScript evaluated successfully.' : '',
                postResponseConsole: 'Executing test: Status is OK\nResult: PASS',
                encryptionConsole: '',
                testScript: 'function testScript(responseStatus, responseTime, responseBody){\n    let passed = true;\n    //Add test assertions here\n    return passed;\n}',
                testScriptEnabled: false
            },
            encryption: {
                algorithm: 'none',
                key: '',
                autoEncryptBody: false,
                autoEncryptHeaders: false,
                channelName: '',
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: 'async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {\n    function getNestedValue(obj, path) {\n        return path.split(\'.\').reduce((acc, part) => acc && acc[part], obj);\n    }\n    function setNestedValue(obj, path, value) {\n        const parts = path.split(\'.\');\n        const last = parts.pop();\n        const target = parts.reduce((acc, part) => {\n            if (!acc[part]) acc[part] = {};\n            return acc[part];\n        }, obj);\n        if (target) target[last] = value;\n    }\n    function getPrimitivePaths(obj, currentPath = \'\') {\n        let paths = [];\n        for (let key in obj) {\n            if (obj.hasOwnProperty(key)) {\n                const path = currentPath ? `${currentPath}.${key}` : key;\n                if (obj[key] !== null && typeof obj[key] === \'object\') {\n                    paths = paths.concat(getPrimitivePaths(obj[key], path));\n                } else {\n                    paths.push(path);\n                }\n            }\n        }\n        return paths;\n    }\n    const parameters = {};\n    const shouldEncryptAllHeaders = typeof autoEncryptHeaders !== \'undefined\' ? autoEncryptHeaders : false;\n    const encHeadersList = encryptedHeaders || [];\n    for (let h of headers) {\n        if (h.enabled && h.key) {\n            if (shouldEncryptAllHeaders || encHeadersList.includes(h.key)) {\n                parameters[h.key] = h.value;\n            }\n        }\n    }\n    let bodyObj = null;\n    if (body) {\n        try {\n            bodyObj = JSON.parse(body);\n        } catch (e) {}\n    }\n    if (bodyObj) {\n        const shouldEncryptAllBody = typeof autoEncryptBody !== \'undefined\' ? autoEncryptBody : false;\n        const encBodyPathsList = encryptedBodyPaths || [];\n        if (shouldEncryptAllBody) {\n            const allPaths = getPrimitivePaths(bodyObj);\n            for (let path of allPaths) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        } else {\n            for (let path of encBodyPathsList) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        }\n    }\n    if (Object.keys(parameters).length > 0) {\n        try {\n            const chName = typeof channelName !== \'undefined\' ? channelName : \'Default Channel\';\n            const response = await fetch(\'https://localhost:7131/api/v1/auth/encrypt\', {\n                method: \'POST\',\n                headers: {\n                    \'Content-Type\': \'application/json\'\n                },\n                body: JSON.stringify({\n                    channelName: chName,\n                    parameters: parameters\n                })\n            });\n            if (response.ok) {\n                const result = await response.json();\n                const encryptedParams = result.parameters || result;\n                for (let h of headers) {\n                    if (h.key && encryptedParams[h.key] !== undefined) {\n                        h.value = String(encryptedParams[h.key]);\n                    }\n                }\n                if (bodyObj) {\n                    for (let key in encryptedParams) {\n                        if (encryptedParams.hasOwnProperty(key)) {\n                            if (key.includes(\'.\') || getNestedValue(bodyObj, key) !== undefined) {\n                                setNestedValue(bodyObj, key, encryptedParams[key]);\n                            }\n                        }\n                    }\n                    body = JSON.stringify(bodyObj, null, 2);\n                }\n            }\n        } catch (error) {\n            console.error(\'Error during payload encryption:\', error);\n        }\n    }\n    return body;\n}'
            },
            settings: { followRedirects: true, verifySsl: true, enableCookies: true, bypassCors: true },
        };
    }

    private createId(): string {
        if (this.isBrowser && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}
