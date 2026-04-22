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
    autoEncrypt: boolean;
    channelName: string;
}

export interface SettingsState {
    followRedirects: boolean;
    verifySsl: boolean;
    enableCookies: boolean;
}

export interface RequestState {
    id: string;
    url: string;
    method: string;
    name: string;
    isDirty: boolean;
    isLoading: boolean;
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
}

@Injectable({
    providedIn: 'root',
})
export class TabStateService {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);
    private states = signal<Map<string, RequestState>>(new Map());
    activeTabId = signal<string | null>(null);
    isCollectionLoading = signal<boolean>(false);
    isSaving = signal<boolean>(false);

    // In-memory "database" of saved requests
    savedCollection = signal<RequestState[]>([]);

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
                localStorage.setItem('postonsteroids_states', JSON.stringify(currentStates));
                localStorage.setItem('postonsteroids_active_tab', this.activeTabId() || '');
            }
        });
    }

    private loadFromStorage() {
        if (!this.isBrowser) return;
        const savedStates = localStorage.getItem('postonsteroids_states');
        const activeTabId = localStorage.getItem('postonsteroids_active_tab');
        
        if (savedStates) {
            try {
                const parsed = JSON.parse(savedStates);
                this.states.set(new Map(parsed));
            } catch (e) {
                console.error('Failed to load states from storage', e);
            }
        }
        
        if (activeTabId) {
            this.activeTabId.set(activeTabId);
        }
    }

    setActiveTab(id: string) {
        if (!this.states().has(id)) {
            this.states.update(map => {
                map.set(id, this.getDefaultState(id));
                return new Map(map);
            });
        }
        this.activeTabId.set(id);
    }

    async fetchCollectionData(collectionName: string) {
        this.isCollectionLoading.set(true);

        this.states.update(map => {
            const newMap = new Map(map);
            for (const [id, state] of newMap.entries()) {
                const dummyData = this.generateDummyData(id);
                newMap.set(id, { ...state, ...dummyData, isLoading: false });
            }
            return newMap;
        });

        this.isCollectionLoading.set(false);
    }

    async fetchTabData(id: string) {
        this.updateState(id, { isLoading: true });
        const dummyData = this.generateDummyData(id);
        this.updateState(id, { ...dummyData, isLoading: false });
    }

    async saveToCollection(id: string): Promise<void> {
        this.isSaving.set(true);

        const currentState = this.states().get(id);
        if (currentState) {
            this.savedCollection.update(col => {
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

    updateState(id: string, partialState: Partial<RequestState>) {
        this.states.update(map => {
            const currentState = map.get(id) || this.getDefaultState(id);
            map.set(id, { ...currentState, ...partialState });
            return new Map(map);
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
                postResponseConsole: ''
            },
            encryption: { algorithm: 'none', key: '', autoEncrypt: false, channelName: '' },
            settings: { followRedirects: true, verifySsl: true, enableCookies: true },
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
            isDirty: Math.random() > 0.5,
            payloadType: 'params',
            bodyType: method === 'POST' || method === 'PUT' ? 'raw' : 'none',
            rawType: 'JSON',
            scripts: {
                preRequest: method === 'POST' ? `function preScript(headers, body, params){\n    const timestamp = Date.now();\n    headers.push({ enabled: true, key: 'X-Timestamp', value: String(timestamp) });\n}` : 'function preScript(headers, body, params){\n    //only code written within this code block will be executed\n}',
                postResponse: `function postScript(responseHeader, responseBody){\n    //only code written within this code block will be executed\n}`,
                preRequestConsole: method === 'POST' ? 'Setting variable timestamp to 1710587421932\nScript evaluated successfully.' : '',
                postResponseConsole: 'Executing test: Status is OK\nResult: PASS'
            },
            encryption: { algorithm: 'none', key: '', autoEncrypt: false, channelName: '' },
            settings: { followRedirects: true, verifySsl: true, enableCookies: true },
        };
    }
}
