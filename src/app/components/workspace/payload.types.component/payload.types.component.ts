import { Component, inject, computed, signal, ViewChild, ElementRef, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, KeyValue, AuthState, EncryptionState, SettingsState } from '../../../shared/services/tab.state.service';
import { SandboxExecutionService } from '../../../shared/services/sandbox.execution.service';
import { VariableService } from '../../../shared/services/variable.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { ScriptManagementService } from '../../../shared/services/script.management.service';
import { ChangeDetectionStrategy, input } from '@angular/core';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { BodyTypesComponent } from "../body.types.component/body.types.component";
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor.component/monaco-editor.component';
import { VariableInputComponent } from '../../../shared/components/variable-input.component/variable-input.component';
import { STANDARD_TEST_SNIPPETS, TestSnippet } from '../../../shared/constants/test.snippets.constants';
import { PRE_REQUEST_SNIPPETS, POST_RESPONSE_SNIPPETS, ScriptSnippet } from '../../../shared/constants/script.snippets.constants';

@Component({
  selector: 'app-payload-types-component',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIcon, ScrollableSelectComponent, BodyTypesComponent, MonacoEditorComponent, VariableInputComponent],
  templateUrl: './payload.types.component.html',
  styleUrl: './payload.types.component.css',
  host: {
    class: 'flex-1 flex flex-col min-h-0'
  }
})
export class PayloadTypesComponent {
  tabStateService = inject(TabStateService);
  variableService = inject(VariableService);
  private notificationService = inject(NotificationService);
  scriptManagementService = inject(ScriptManagementService);
  sandboxService = inject(SandboxExecutionService);

  constructor() {
    effect(() => {
        // Run this effect when encryptionScripts updates
        const scripts = this.encryptionScripts();
        
        // Let's only set this once if active is empty
        if (!this.activeEncryptionScriptId() && scripts.length > 0) {
            const encryptScript = scripts.find(s => s.name === 'Encrypt');
            if (encryptScript) {
                this.activeEncryptionScriptId.set(encryptScript.id);
                // If tab state is completely empty, populate it.
                if (!this.encryption().script) {
                    this.setEncryptionField('script', encryptScript.content);
                }
            }
        }
    }, { allowSignalWrites: true });
  }

  payloadTypes = ['params', 'auth', 'headers', 'body', 'scripts', 'encryption', 'settings'];
  authTypes: AuthState['type'][] = ['none', 'bearer'];

  // State for Bulk Edit
  isRawParams = signal(false);
  isRawHeaders = signal(false);
  rawParamsText = signal('');
  rawHeadersText = signal('');

  // State for Scripts
  activeScriptTab = signal<'preRequest' | 'postResponse' | 'test'>('preRequest');
  scriptOptions = signal(['Pre-request Script', 'Post-response Script', 'Test Script']);

  // Script Management
  encryptionScripts = computed(() => this.scriptManagementService.scripts().filter(s => s.type === 'Encryption'));
  preRequestScripts = computed(() => this.scriptManagementService.scripts().filter(s => s.type === 'PreRequest'));
  postRequestScripts = computed(() => this.scriptManagementService.scripts().filter(s => s.type === 'PostRequest'));
  testScripts = computed(() => this.scriptManagementService.scripts().filter(s => s.type === 'Test'));

  activeEncryptionScriptId = signal<string>('');
  activePreRequestScriptId = signal<string>('');
  activePostRequestScriptId = signal<string>('');
  activeTestScriptId = signal<string>('');

  get activeEncryptionScriptName() {
    const s = this.encryptionScripts().find(x => x.id === this.activeEncryptionScriptId());
    return s ? s.name : 'Select Script...';
  }
  
  get encryptionScriptOptions() { return ['+ Add New Script', ...this.encryptionScripts().map(s => s.name)]; }
  get encryptionScriptTooltips() {
    const map: Record<string, string> = { '+ Add New Script': 'Create a new encryption script' };
    for (const s of this.encryptionScripts()) {
      map[s.name] = s.name;
    }
    return map;
  }

    async loadEncryptionScript(name: string) {
    if (name === '+ Add New Script') {
        const scriptName = window.prompt('Enter new script name:');
        if (scriptName) {
            const newScript = await this.scriptManagementService.createScript('Encryption', scriptName, '// new script');
            if (newScript) {
                this.activeEncryptionScriptId.set(newScript.id);
                this.setEncryptionField('script', newScript.content);
            }
        }
        return;
    }
    const s = this.encryptionScripts().find(x => x.name === name);
    if (s) {
        this.activeEncryptionScriptId.set(s.id);
        this.setEncryptionField('script', '');
        setTimeout(() => {
            this.setEncryptionField('script', s.content);
        }, 10);
    }
  }



  async runActiveEncryptionScript() {
        this.isRunningEncryptionScript.set(true);
        try {
      const code = this.encryption().script;
      const state = this.tabState();
      let requestBody = '';
      
      if (state?.bodyType === 'raw') {
          requestBody = state.rawBody || '';
      } else if (state?.bodyType === 'form-data') {
          const fd: Record<string, string> = {};
          for (const row of state.formData || []) {
             if (row.enabled && row.key) fd[row.key] = row.value;
          }
          requestBody = JSON.stringify(fd);
      }
      
      // Strip single-line and multi-line comments from JSON body before passing to sandbox
      const cleanBody = requestBody.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
      
      const context = {
          headers: state?.headers || [],
          body: cleanBody || requestBody,
          params: state?.params || [],
          encryptedHeaders: state?.encryption.encryptedHeaders || [],
          encryptedBodyPaths: state?.encryption.encryptedBodyPaths || [],
          autoEncryptBody: state?.encryption.autoEncryptBody || false,
          autoEncryptHeaders: state?.encryption.autoEncryptHeaders || false,
          
      };

      const result = await this.sandboxService.executeScript(code, context);
      const currentScripts = state?.scripts || {} as any;

      if (result.success) {
          const bodyOut = result.context?.body;
          const resultString = typeof bodyOut === 'object' ? JSON.stringify(bodyOut, null, 2) : String(bodyOut);
          
          let outText = `Result:\n${resultString}`;
          if (result.logs) {
              outText = `Logs:\n${result.logs}\n\n${outText}`;
          }
          
          this.tabStateService.updateState(this.tabId(), {
              scripts: {
                  ...currentScripts,
                  encryptionConsole: outText
              }
          });
          this.notificationService.notify('Encryption ran successfully. Check console.');
      } else {
          console.error("Encryption run error:", result.error);
          this.tabStateService.updateState(this.tabId(), {
              scripts: {
                  ...currentScripts,
                  encryptionConsole: `Error:\n${result.error}\n\nLogs:\n${result.logs || ''}`
              }
          });
          this.notificationService.notify('Encryption script error: ' + result.error);
      }
        } finally {
            this.isRunningEncryptionScript.set(false);
        }
    }

  // Pre-Request and Post-Request Logic
  get activePreRequestScriptName() {
    const s = this.preRequestScripts().find(x => x.id === this.activePreRequestScriptId());
    return s ? s.name : 'Select Script...';
  }
  get preRequestScriptOptions() { return ['+ Add New Script', ...this.preRequestScripts().map(s => s.name)]; }
  get preRequestScriptTooltips() {
    const map: Record<string, string> = { '+ Add New Script': 'Create a new pre-request script' };
    for (const s of this.preRequestScripts()) {
      map[s.name] = s.name;
    }
    return map;
  }
  
  get activePostRequestScriptName() {
    const s = this.postRequestScripts().find(x => x.id === this.activePostRequestScriptId());
    return s ? s.name : 'Select Script...';
  }
    get postRequestScriptOptions() { return ['+ Add New Script', ...this.postRequestScripts().map(s => s.name)]; }
  get postRequestScriptTooltips() {
    const map: Record<string, string> = { '+ Add New Script': 'Create a new post-response script' };
    for (const s of this.postRequestScripts()) {
      map[s.name] = s.name;
    }
    return map;
  }
  
  get activeTestScriptName() {
    const s = this.testScripts().find(x => x.id === this.activeTestScriptId());
    return s ? s.name : 'Select Script...';
  }
  get testScriptOptions() { return ['+ Add New Script', ...this.testScripts().map(s => s.name)]; }
  get testScriptTooltips() {
    const map: Record<string, string> = { '+ Add New Script': 'Create a new test script' };
    for (const s of this.testScripts()) {
      map[s.name] = s.name;
    }
    return map;
  }

    async loadCurrentPhaseScript(name: string) {
    if (name === '+ Add New Script') {
        const scriptName = window.prompt('Enter new script name:');
        if (scriptName) {
            const phase = this.activeScriptTab();
            const type = phase === 'preRequest' ? 'PreRequest' : phase === 'postResponse' ? 'PostRequest' : 'Test';
            const newScript = await this.scriptManagementService.createScript(type, scriptName, '// new script');
            if (newScript) {
                if (phase === 'preRequest') this.activePreRequestScriptId.set(newScript.id);
                if (phase === 'postResponse') this.activePostRequestScriptId.set(newScript.id);
                if (phase === 'test') this.activeTestScriptId.set(newScript.id);
                this.updateScript(phase, newScript.content);
            }
        }
        return;
    }
    if (this.activeScriptTab() === 'preRequest') {
        const s = this.preRequestScripts().find(x => x.name === name);
        if (s) {
            this.activePreRequestScriptId.set(s.id);
            this.updateScript('preRequest', s.content);
        }
    } else if (this.activeScriptTab() === 'postResponse') {
        const s = this.postRequestScripts().find(x => x.name === name);
        if (s) {
            this.activePostRequestScriptId.set(s.id);
            this.updateScript('postResponse', s.content);
        }
    }
  }
  


  async runCurrentPhaseScript() {
      const code = this.getScriptContent();
      try {
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          // Simple sandbox stub for pre/post scripts
          const mockPm = {
              environment: { get: () => 'mock', set: () => {} },
              variables: { get: () => 'mock', set: () => {} },
              test: (name: string, fn: Function) => {
                  try { fn(); console.log('Test passed:', name); }
                  catch (e) { console.error('Test failed:', name, e); }
              },
              response: { to: { have: { status: () => {} } } }
          };
          const fn = new AsyncFunction('pm', 'console', code);
          await fn(mockPm, console);
          this.notificationService.notify('Script ran successfully. Check console.');
      } catch (err: any) {
          console.error("Script run error:", err);
          this.notificationService.notify('Script error: ' + err.message);
      }
  }

  // Standard Test Snippets
  standardTestSnippets = signal<TestSnippet[]>(STANDARD_TEST_SNIPPETS);
  testSnippetOptions = computed(() => ['Add Snippet...', ...this.standardTestSnippets().map(s => s.name)]);
  selectedTestSnippet = signal<string>('Add Snippet...');
  testSnippetTooltips = computed(() => {
    const map: Record<string, string> = {};
    for (const s of this.standardTestSnippets()) {
      map[s.name] = s.description;
    }
    return map;
  });

  // Phase Snippets
  preRequestSnippets = signal<ScriptSnippet[]>(PRE_REQUEST_SNIPPETS);
  preRequestSnippetOptions = computed(() => ['Add Snippet...', ...this.preRequestSnippets().map(s => s.name)]);
  selectedPreRequestSnippet = signal<string>('Add Snippet...');
  preRequestSnippetTooltips = computed(() => {
    const map: Record<string, string> = {};
    for (const s of this.preRequestSnippets()) {
      map[s.name] = s.description;
    }
    return map;
  });

  postResponseSnippets = signal<ScriptSnippet[]>(POST_RESPONSE_SNIPPETS);
  postResponseSnippetOptions = computed(() => ['Add Snippet...', ...this.postResponseSnippets().map(s => s.name)]);
  selectedPostResponseSnippet = signal<string>('Add Snippet...');
  postResponseSnippetTooltips = computed(() => {
    const map: Record<string, string> = {};
    for (const s of this.postResponseSnippets()) {
      map[s.name] = s.description;
    }
    return map;
  });

  addPhaseSnippet(phase: 'preRequest' | 'postResponse', snippetName: string) {
    if (!snippetName || snippetName === 'Add Snippet...') return;

    const snippets = phase === 'preRequest' ? this.preRequestSnippets() : this.postResponseSnippets();
    const snippet = snippets.find(s => s.name === snippetName);
    if (!snippet) return;

    const currentScript = phase === 'preRequest' ? this.scripts().preRequest : this.scripts().postResponse;
    let updatedScript = '';
    
    const defPre = 'function preScript(headers, body, params){\n    //only code written within this code block will be executed\n}';
    const defPost = 'function postScript(responseHeader, responseBody){\n    //only code written within this code block will be executed\n}';

    if (!currentScript || !currentScript.trim() || currentScript === defPre || currentScript === defPost) {
      if (phase === 'preRequest') {
        updatedScript = `function preScript(headers, body, params){\n${snippet.code}\n}`;
      } else {
        updatedScript = `function postScript(responseHeader, responseBody){\n${snippet.code}\n}`;
      }
    } else if (currentScript.lastIndexOf('}') !== -1) {
      const lastCloseBrace = currentScript.lastIndexOf('}');
      updatedScript = currentScript.slice(0, lastCloseBrace) + `\n${snippet.code}\n` + currentScript.slice(lastCloseBrace);
    } else {
      updatedScript = currentScript + `\n\n${snippet.code}`;
    }

    const currentScripts = this.scripts();
    this.tabStateService.updateState(this.tabId(), {
      scripts: {
        ...currentScripts,
        [phase]: updatedScript
      }
    });

    this.notificationService.notify(`Added snippet: ${snippet.name}`);
    if (phase === 'preRequest') this.selectedPreRequestSnippet.set('Add Snippet...');
    else this.selectedPostResponseSnippet.set('Add Snippet...');
  }

  displayScriptTab = computed(() => {
    const tab = this.activeScriptTab();
    switch(tab) {
      case 'preRequest': return 'Pre-request Script';
      case 'postResponse': return 'Post-response Script';
      case 'test': return 'Test Script';
      default: return 'Pre-request Script';
    }
  });

  setScriptTab(option: string) {
    if (option === 'Pre-request Script') this.activeScriptTab.set('preRequest');
    else if (option === 'Post-response Script') this.activeScriptTab.set('postResponse');
    else if (option === 'Test Script') this.activeScriptTab.set('test');
  }

  // State for Auth
  isTokenVisible = signal(false);
  isRunningEncryptionScript = signal(false);

  tabId = input.required<string>();
  tabState = computed(() => this.tabStateService.getState(this.tabId()));

  payloadType = computed(() => this.tabState()?.payloadType ?? 'params');
  params = computed(() => this.tabState()?.params ?? []);
  headers = computed(() => this.tabState()?.headers ?? []);
  auth = computed(() => this.tabState()?.auth ?? { type: 'none' as const, token: '' });
  scripts = computed(() => this.tabState()?.scripts ?? { preRequest: '', postResponse: '', preRequestConsole: '', postResponseConsole: '', encryptionConsole: '', testScript: '', testScriptEnabled: false });
  encryption = computed(() => this.tabState()?.encryption ?? { algorithm: 'none' as const, key: '', autoEncryptBody: false, autoEncryptHeaders: false, encryptedHeaders: [], encryptedBodyPaths: [], script: '' });
  settings = computed(() => this.tabState()?.settings ?? { followRedirects: true, verifySsl: true, enableCookies: true, bypassCors: true });

  setPayloadType(type: string) {
    this.tabStateService.updateState(this.tabId(), { payloadType: type });
  }

  private updateKVField(field: 'params' | 'headers', index: number, key: keyof KeyValue, val: string | boolean) {
    const rows = [...(this.tabState()?.[field] ?? [])] as KeyValue[];
    if (index < 0 || index >= rows.length) return;
    const row = rows[index];
    if (key === 'enabled') rows[index] = { ...row, enabled: val as boolean };
    else if (key === 'key') rows[index] = { ...row, key: val as string };
    else if (key === 'value') rows[index] = { ...row, value: val as string };
    this.tabStateService.updateState(this.tabId(), { [field]: rows });
  }

  // ── Params ───────────────────────────────────────────────────────────
  addKeyValueToVariable(key: string, value: string, type: 'param' | 'header' = 'param') {
    const state = this.tabState();
    this.variableService.openAddModal(key || '', value || '', {
      tabId: this.tabId(),
      requestName: state?.name,
      requestUrl: state?.url,
      type,
      propertyKey: key || ''
    });
  }

  updateParam(i: number, key: keyof KeyValue, val: string | boolean) { this.updateKVField('params', i, key, val); }
  addParam() {
    this.tabStateService.updateState(this.tabId(), { params: [...this.params(), { enabled: true, key: '', value: '' }] });
  }
  deleteParam(i: number) {
    const rows = this.params().filter((_, idx) => idx !== i);
    this.tabStateService.updateState(this.tabId(), { params: rows.length ? rows : [{ enabled: true, key: '', value: '' }] });
  }

  toggleRawParams() {
    if (!this.isRawParams()) {
      this.rawParamsText.set(this.stringifyKV(this.params()));
    } else {
      this.paramsFromRaw();
    }
    this.isRawParams.update(v => !v);
  }

  onRawParamsChange(text: string) {
    this.rawParamsText.set(text);
    this.paramsFromRaw();
  }

  private paramsFromRaw() {
    const parsed = this.parseRawKV(this.rawParamsText());
    this.tabStateService.updateState(this.tabId(), { params: parsed });
  }

  // ── Headers ──────────────────────────────────────────────────────────
  updateHeader(i: number, key: keyof KeyValue, val: string | boolean) { this.updateKVField('headers', i, key, val); }
  addHeader() {
    this.tabStateService.updateState(this.tabId(), { headers: [...this.headers(), { enabled: true, key: '', value: '' }] });
  }
  deleteHeader(i: number) {
    const rows = this.headers().filter((_, idx) => idx !== i);
    this.tabStateService.updateState(this.tabId(), { headers: rows.length ? rows : [{ enabled: true, key: '', value: '' }] });
  }

  toggleRawHeaders() {
    if (!this.isRawHeaders()) {
      this.rawHeadersText.set(this.stringifyKV(this.headers()));
    } else {
      this.headersFromRaw();
    }
    this.isRawHeaders.update(v => !v);
  }

  onRawHeadersChange(text: string) {
    this.rawHeadersText.set(text);
    this.headersFromRaw();
  }

  private headersFromRaw() {
    const parsed = this.parseRawKV(this.rawHeadersText());
    this.tabStateService.updateState(this.tabId(), { headers: parsed });
  }

  // ── KV Utilities ─────────────────────────────────────────────────────
  private stringifyKV(kv: KeyValue[]): string {
    return kv
      .filter(r => r.key || r.value)
      .map(r => `${r.key}: ${r.value}`)
      .join('\n');
  }

  private parseRawKV(text: string): KeyValue[] {
    const lines = text.split('\n').filter(l => l.trim());
    const result = lines.map(line => {
      const index = line.indexOf(':');
      if (index === -1) return { enabled: true, key: line.trim(), value: '' };
      return {
        enabled: true,
        key: line.substring(0, index).trim(),
        value: line.substring(index + 1).trim()
      };
    });
    return result.length ? result : [{ enabled: true, key: '', value: '' }];
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  setAuthType(type: AuthState['type']) {
    const current = this.auth();
    const updated: AuthState = { type, token: current.token };
    this.tabStateService.updateState(this.tabId(), { auth: updated });
  }
  updateAuth(field: keyof Omit<AuthState, 'type'>, val: string) {
    const current = this.auth();
    const updated: AuthState = { ...current, [field]: val };
    this.tabStateService.updateState(this.tabId(), { auth: updated });
  }

  toggleTokenVisibility() {
    this.isTokenVisible.update(v => !v);
  }

  // ── Scripts ──────────────────────────────────────────────────────────
  updateScript(phase: 'preRequest' | 'postResponse' | 'test', code: string) {
    const current = this.scripts();
    if (phase === 'test') {
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, testScript: code } });
    } else {
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, [phase]: code } });
    }
  }

  async resetScript() {
    const current = this.scripts();
    if (this.activeScriptTab() === 'test') {
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, testScript: '' } });
    } else {
      let activeId = this.activeScriptTab() === 'preRequest' ? this.activePreRequestScriptId() : this.activePostRequestScriptId();
      if (activeId) {
          const resetDto = await this.scriptManagementService.resetScript(activeId);
          if (resetDto) {
              this.tabStateService.updateState(this.tabId(), { scripts: { ...current, [this.activeScriptTab()]: resetDto.content } });
          }
      } else {
          const defaultState = this.tabStateService.getDefaultState(this.tabId());
          const defaultScript = this.activeScriptTab() === 'preRequest' ? defaultState.scripts?.preRequest : defaultState.scripts?.postResponse;
          this.tabStateService.updateState(this.tabId(), { scripts: { ...current, [this.activeScriptTab()]: defaultScript ?? '' } });
      }
    }
  }

  toggleTestScript() {
    const current = this.scripts();
    this.tabStateService.updateState(this.tabId(), { scripts: { ...current, testScriptEnabled: !current.testScriptEnabled } });
  }

  addTestSnippet(snippetName: string) {
    if (!snippetName || snippetName === 'Add Snippet...') return;
    const snippet = this.standardTestSnippets().find(s => s.name === snippetName);
    if (!snippet) return;

    const currentScript = this.scripts().testScript || '';
    let updatedScript = '';

    if (!currentScript.trim()) {
      updatedScript = `function testScript(responseStatus, responseTime, responseBody){\n    let passed = true;\n\n${snippet.code}\n\n    return passed;\n}`;
    } else if (currentScript.includes('return passed;')) {
      updatedScript = currentScript.replace(
        'return passed;',
        `${snippet.code}\n\n    return passed;`
      );
    } else if (currentScript.includes('return ')) {
      const lastReturnIndex = currentScript.lastIndexOf('return ');
      updatedScript = currentScript.slice(0, lastReturnIndex) + `${snippet.code}\n\n    ` + currentScript.slice(lastReturnIndex);
    } else if (currentScript.lastIndexOf('}') !== -1) {
      const lastCloseBrace = currentScript.lastIndexOf('}');
      updatedScript = currentScript.slice(0, lastCloseBrace) + `\n${snippet.code}\n` + currentScript.slice(lastCloseBrace);
    } else {
      updatedScript = currentScript + `\n\n${snippet.code}`;
    }

    const currentScripts = this.scripts();
    this.tabStateService.updateState(this.tabId(), {
      scripts: {
        ...currentScripts,
        testScript: updatedScript,
        testScriptEnabled: true
      }
    });

    this.notificationService.notify(`Added test snippet: ${snippet.name}`);
    setTimeout(() => this.selectedTestSnippet.set('Add Snippet...'), 200);
  }

  getScriptContent(): string {
    const tab = this.activeScriptTab();
    if (tab === 'preRequest') return this.scripts().preRequest;
    if (tab === 'postResponse') return this.scripts().postResponse;
    return '';
  }

  async resetEncryptionScript() {
    const id = this.activeEncryptionScriptId();
    if (id) {
        const resetDto = await this.scriptManagementService.resetScript(id);
        if (resetDto) {
            this.setEncryptionField('script', resetDto.content);
        }
    } else {
        const defaultState = this.tabStateService.getDefaultState(this.tabId());
        const defaultScript = defaultState.encryption?.script ?? '';
        this.setEncryptionField('script', defaultScript);
    }
  }

  // ── Encryption ───────────────────────────────────────────────────────
  setEncryptionField(field: keyof EncryptionState, value: any) {
    const current = this.encryption();
    this.tabStateService.updateState(this.tabId(), {
      encryption: { ...current, [field]: value }
    });
  }

  toggleAutoEncryptHeaders() {
    const current = this.encryption();
    let newEncryptedHeaders: string[] = [];
    
    // If any are encrypted, clear them. Otherwise, encrypt all valid headers.
    if (current.encryptedHeaders && current.encryptedHeaders.length > 0) {
        newEncryptedHeaders = [];
    } else {
        newEncryptedHeaders = this.headers()
            .filter(h => h.key && h.key.trim() !== '')
            .map(h => h.key);
    }
    
    this.tabStateService.updateState(this.tabId(), {
      encryption: { ...current, encryptedHeaders: newEncryptedHeaders }
    });
  }

  toggleHeaderEncryption(key: string) {
    if (!key) return;
    const current = this.encryption();
    const headers = new Set(current.encryptedHeaders || []);
    if (headers.has(key)) {
      headers.delete(key);
    } else {
      headers.add(key);
    }
    this.setEncryptionField('encryptedHeaders', Array.from(headers));
  }

  // ── Settings ─────────────────────────────────────────────────────────
  toggleSetting(field: keyof SettingsState, val: boolean) {
    const current = this.settings();
    const updated: SettingsState = { ...current, [field]: val };
    this.tabStateService.updateState(this.tabId(), { settings: updated });
  }
}





