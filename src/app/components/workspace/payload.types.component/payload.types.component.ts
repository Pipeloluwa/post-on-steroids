import { Component, inject, computed, signal, ViewChild, ElementRef, effect, viewChild } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, KeyValue, AuthState, EncryptionState, SettingsState, OAuth2Config, AwsSigV4Config } from '../../../shared/services/tab.state.service';
import { environment } from '../../../../environments/environment';
import { SandboxExecutionService } from '../../../shared/services/sandbox.execution.service';
import { VariableService } from '../../../shared/services/variable.service';
import { EnvironmentService } from '../../../shared/services/environment.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { ScriptManagementService } from '../../../shared/services/script.management.service';
import { ChangeDetectionStrategy, input } from '@angular/core';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { BodyTypesComponent } from "../body.types.component/body.types.component";
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor.component/monaco-editor.component';
import { VariableInputComponent } from '../../../shared/components/variable-input.component/variable-input.component';
import { STANDARD_TEST_SNIPPETS, TestSnippet } from '../../../shared/constants/test.snippets.constants';
import {
  PRE_REQUEST_SNIPPETS,
  POST_RESPONSE_SNIPPETS,
  ScriptSnippet,
  ScriptLanguage,
  DEFAULT_ENCRYPTION_SCRIPT_SKELETON,
  DEFAULT_DECRYPTION_SCRIPT_SKELETON,
  DEFAULT_PRE_REQUEST_SCRIPT_SKELETON,
  DEFAULT_POST_RESPONSE_SCRIPT_SKELETON,
  DEFAULT_TEST_SCRIPT_SKELETON,
  isDefaultSkeletonCode
} from '../../../shared/constants/script.snippets.constants';
import { detectScriptLanguage } from '../../../shared/utils/python-script-engine.util';
import {
  RequestFieldTarget,
  RequestFieldLinkMutation,
  extractValueByPath,
  applyRequestFieldLinksToTabState,
  collectJsonFieldPaths,
  buildFieldLinkCodeSnippet
} from '../../../shared/utils/script-field-link.util';
import { DialogService } from '../../../shared/services/dialog.service';
import { sanitizeJsonBodyForScripts } from '../../../shared/utils/format.utils';
import { buildEncryptionPayloadContext, reconcileEncryptionResult } from '../../../shared/utils/encryption-path.util';
import { isElectronApp } from '../../../shared/utils/url.util';
import { formatTimeoutLabel, parseTimeoutInputValue } from '../../../shared/utils/request-timeout.util';

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
  private environmentService = inject(EnvironmentService);
  private http = inject(HttpClient);
  private notificationService = inject(NotificationService);
  scriptManagementService = inject(ScriptManagementService);
  sandboxService = inject(SandboxExecutionService);
  dialogService = inject(DialogService);
  isElectron = isElectronApp();

  private saveScriptSubject = new Subject<{ id: string, name: string, content: string }>();

  constructor() {
    this.saveScriptSubject.pipe(debounceTime(1000)).subscribe(async ({ id, name, content }) => {
      if (id) {
        const updated = await this.scriptManagementService.updateScript(id, name, content);
        if (updated && updated.id !== id) {
          if (this.activeEncryptionScriptId() === id) this.activeEncryptionScriptId.set(updated.id);
          if (this.activePreRequestScriptId() === id) this.activePreRequestScriptId.set(updated.id);
          if (this.activePostRequestScriptId() === id) this.activePostRequestScriptId.set(updated.id);
          if (this.activeTestScriptId() === id) this.activeTestScriptId.set(updated.id);
        }
      }
    });

    // Automatically sync encryption script state with script.management.service
    effect(() => {
        const scripts = this.encryptionScripts();
        if (scripts.length > 0) {
            const currentScript = this.encryption()?.script || '';
            const currentActiveId = this.activeEncryptionScriptId();
            const activeExists = currentActiveId && scripts.some(s => s.id === currentActiveId);

            if (!activeExists) {
                let target = currentScript.includes('decryptScript')
                    ? scripts.find(s => s.name.toLowerCase() === 'decrypt')
                    : scripts.find(s => s.name.toLowerCase() === 'encrypt');
                if (!target) target = scripts[0];
                if (target) {
                    this.activeEncryptionScriptId.set(target.id);
                }
            }

            if (!currentScript || !currentScript.trim()) {
                const activeScript = scripts.find(s => s.id === this.activeEncryptionScriptId()) 
                    || scripts.find(s => s.name.toLowerCase() === 'encrypt') 
                    || scripts[0];
                if (activeScript) {
                    const content = (activeScript.content && activeScript.content.trim())
                        ? activeScript.content
                        : this.scriptManagementService.getDefaultContentForScript(activeScript.type, activeScript.name);
                    this.setEncryptionField('script', content, false);
                }
            }
        }
    }, { allowSignalWrites: true });

    // Automatically sync Pre-request script state with script.management.service
    effect(() => {
        const preScripts = this.preRequestScripts();
        const activeExists = this.activePreRequestScriptId() && preScripts.some(s => s.id === this.activePreRequestScriptId());
        if (preScripts.length > 0 && !activeExists) {
            const defaultScript = preScripts.find(s => s.name === 'Pre-request' || s.isDefault) || preScripts[0];
            if (defaultScript) {
                this.activePreRequestScriptId.set(defaultScript.id);
                if (!this.scripts()?.preRequest || !this.scripts().preRequest.trim()) {
                    const content = (defaultScript.content && defaultScript.content.trim())
                        ? defaultScript.content
                        : this.scriptManagementService.getDefaultContentForScript('PreRequest', defaultScript.name);
                    this.updateScript('preRequest', content, false);
                }
            }
        }
    }, { allowSignalWrites: true });

    // Automatically sync Post-response script state with script.management.service
    effect(() => {
        const postScripts = this.postRequestScripts();
        const activeExists = this.activePostRequestScriptId() && postScripts.some(s => s.id === this.activePostRequestScriptId());
        if (postScripts.length > 0 && !activeExists) {
            const defaultScript = postScripts.find(s => s.name === 'Post-response' || s.isDefault) || postScripts[0];
            if (defaultScript) {
                this.activePostRequestScriptId.set(defaultScript.id);
                if (!this.scripts()?.postResponse || !this.scripts().postResponse.trim()) {
                    const content = (defaultScript.content && defaultScript.content.trim())
                        ? defaultScript.content
                        : this.scriptManagementService.getDefaultContentForScript('PostRequest', defaultScript.name);
                    this.updateScript('postResponse', content, false);
                }
            }
        }
    }, { allowSignalWrites: true });

    // Automatically sync Test script state with script.management.service
    effect(() => {
        const testScriptsList = this.testScripts();
        const activeExists = this.activeTestScriptId() && testScriptsList.some(s => s.id === this.activeTestScriptId());
        if (testScriptsList.length > 0 && !activeExists) {
            const defaultScript = testScriptsList.find(s => s.name === 'Test' || s.isDefault) || testScriptsList[0];
            if (defaultScript) {
                this.activeTestScriptId.set(defaultScript.id);
                if (!this.scripts()?.testScript || !this.scripts().testScript.trim()) {
                    const content = (defaultScript.content && defaultScript.content.trim())
                        ? defaultScript.content
                        : this.scriptManagementService.getDefaultContentForScript('Test', defaultScript.name);
                    this.updateScript('test', content, false);
                }
            }
        }
    }, { allowSignalWrites: true });
  }

  payloadTypes = ['params', 'auth', 'headers', 'body', 'scripts', 'encryption', 'settings'];
  authTypes: AuthState['type'][] = ['none', 'bearer', 'basic', 'apikey', 'oauth2', 'aws-sigv4'];
  isFetchingOAuth2Token = signal<boolean>(false);

  authTypeLabel(type: AuthState['type']): string {
    switch (type) {
      case 'none': return 'No Auth';
      case 'bearer': return 'Bearer Token';
      case 'basic': return 'Basic Auth';
      case 'apikey': return 'API Key';
      case 'oauth2': return 'OAuth 2.0';
      case 'aws-sigv4': return 'AWS SigV4';
      default: return type;
    }
  }

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
        const scriptName = await this.dialogService.prompt('Enter new script name:');
        if (scriptName) {
            const lang = this.activeEncryptionLanguage();
            const defaultContent = this.scriptManagementService.getDefaultContentForScript('Encryption', scriptName, lang);
            const newScript = await this.scriptManagementService.createScript('Encryption', scriptName, defaultContent, lang);
            if (newScript) {
                this.activeEncryptionScriptId.set(newScript.id);
                this.setEncryptionField('script', newScript.content, false);
            }
        }
        return;
    }
    const s = this.encryptionScripts().find(x => x.name === name);
    if (s) {
        this.activeEncryptionScriptId.set(s.id);
        const lang = this.activeEncryptionLanguage();
        let content = (s.content && s.content.trim())
            ? s.content
            : this.scriptManagementService.getDefaultContentForScript(s.type, s.name, lang);
        if (s.id.startsWith('default_') && isDefaultSkeletonCode(content) && lang === 'python') {
            content = this.scriptManagementService.getDefaultContentForScript(s.type, s.name, 'python');
        }
        this.setEncryptionField('script', content, false);
    }
  }



  async runActiveEncryptionScript() {
        this.isRunningEncryptionScript.set(true);
        try {
      const encScriptRaw = this.encryption().script || '';
      const code = this.variableService.resolveScript(encScriptRaw);
      const state = this.tabState();
      const currentScriptsBefore = state?.scripts || {} as any;
      // Immediately clear encryption console output before running
      this.tabStateService.updateState(this.tabId(), {
          scripts: {
              ...currentScriptsBefore,
              encryptionConsole: ''
          }
      });

      const prepared = buildEncryptionPayloadContext({
          bodyType: state?.bodyType || 'none',
          rawType: state?.rawType || 'JSON',
          rawBodyJson: state?.rawBodyJson ? this.variableService.resolveJson(state.rawBodyJson) : undefined,
          rawBodyXml: state?.rawBodyXml ? this.variableService.resolve(state.rawBodyXml) : undefined,
          rawBodyText: state?.rawBodyText ? this.variableService.resolve(state.rawBodyText) : undefined,
          rawBody: state?.rawBody ? this.variableService.resolve(state.rawBody) : undefined,
          formData: (state?.formData || []).map(row => ({
              ...row,
              key: this.variableService.resolve(row.key || ''),
              value: typeof row.value === 'string' ? this.variableService.resolve(row.value) : row.value
          })),
          urlEncodedData: (state?.urlEncodedData || []).map(row => ({
              ...row,
              key: this.variableService.resolve(row.key || ''),
              value: this.variableService.resolve(row.value || '')
          })),
          graphqlQuery: state?.graphqlQuery ? this.variableService.resolve(state.graphqlQuery) : '',
          graphqlVariables: state?.graphqlVariables ? this.variableService.resolveJson(state.graphqlVariables) : '{}',
          encryptedBodyPaths: state?.encryption?.encryptedBodyPaths || [],
          autoEncryptBody: state?.encryption?.autoEncryptBody || false
      });

      const rawEncryptedHeaders = state?.encryption?.encryptedHeaders || [];
      const autoEncryptHeaders = !!state?.encryption?.autoEncryptHeaders;
      const normalizedEncryptedHeaders = Array.from(new Set([
          ...rawEncryptedHeaders,
          ...rawEncryptedHeaders.map(k => k.trim()),
          ...rawEncryptedHeaders.map(k => this.variableService.resolve(k).trim())
      ])).filter(Boolean);

      const resolvedHeaders = (state?.headers || []).map(h => {
          const resolvedKey = this.variableService.resolve(h.key || '').trim();
          let resolvedVal = this.variableService.resolve(h.value || '').trim();
          const isTargeted = autoEncryptHeaders || normalizedEncryptedHeaders.some(
              ek => ek.toLowerCase() === resolvedKey.toLowerCase() || ek.toLowerCase() === (h.key || '').trim().toLowerCase()
          );
          if (isTargeted) {
              // Strip accidental surrounding quotes/trailing comma if copied from JSON output
              const quoteMatch = resolvedVal.match(/^["'](.*)["']\s*,?$/s);
              if (quoteMatch) {
                  resolvedVal = quoteMatch[1].trim();
              }
              resolvedVal = resolvedVal.replace(/[\r\n]+/g, '');
          }
          return {
              ...h,
              enabled: h.enabled !== false,
              key: resolvedKey || h.key,
              value: resolvedVal
          };
      });

      // Ensure exact resolved keys of targeted headers are present in encryptedHeaders for script `.includes(h.key)` checks
      for (const rh of resolvedHeaders) {
          if (rh.key && rawEncryptedHeaders.some(ek => ek.trim().toLowerCase() === rh.key.trim().toLowerCase())) {
              if (!normalizedEncryptedHeaders.includes(rh.key)) {
                  normalizedEncryptedHeaders.push(rh.key);
              }
          }
      }

      const context = {
          headers: resolvedHeaders,
          body: prepared.body,
          params: state?.params || [],
          encryptedHeaders: normalizedEncryptedHeaders,
          encryptedBodyPaths: prepared.encryptedBodyPaths,
          bodyType: prepared.bodyType,
          rawType: prepared.rawType,
          formData: prepared.formData,
          encryptedFormData: prepared.encryptedFormData,
          urlEncodedData: prepared.urlEncodedData,
          encryptedUrlEncodedData: prepared.encryptedUrlEncodedData,
          graphql: prepared.graphql,
          encryptedGraphqlPaths: prepared.encryptedGraphqlPaths,
          rawText: prepared.rawText,
          encryptRawText: prepared.encryptRawText,
          autoEncryptBody: prepared.autoEncryptBody,
          autoEncryptHeaders: autoEncryptHeaders,
      };

      const result = await this.sandboxService.executeScript(code, context, this.activeEncryptionLanguage());
      const currentScripts = state?.scripts || {} as any;

      if (result.success) {
          const headersOut: KeyValue[] = Array.isArray(result.context?.headers) ? result.context.headers : [];
          const targetedOrModifiedHeaders = headersOut.filter((h, idx) => {
              if (!h || h.enabled === false || !h.key || !h.key.trim()) return false;
              const keyLower = h.key.trim().toLowerCase();
              const wasTargeted = autoEncryptHeaders || normalizedEncryptedHeaders.some(ek => ek.trim().toLowerCase() === keyLower);
              const wasModified = resolvedHeaders[idx] && resolvedHeaders[idx].value !== h.value;
              return wasTargeted || wasModified;
          });

          const reconciledBody = reconcileEncryptionResult(prepared, result.context);
          const bodyString = typeof reconciledBody === 'object' ? JSON.stringify(reconciledBody, null, 2) : String(reconciledBody ?? '');
          const hasBodyTargets = prepared.encryptedBodyPaths.length > 0 || prepared.autoEncryptBody;
          const bodyWasModified = bodyString.trim() !== '' && bodyString.trim() !== '{}' && bodyString.trim() !== prepared.initialBodyStr.trim();

          let resultString = bodyString;
          if (targetedOrModifiedHeaders.length > 0) {
              const headersObj: Record<string, string> = {};
              for (const h of targetedOrModifiedHeaders) {
                  headersObj[h.key] = h.value;
              }
              const headersJson = JSON.stringify(headersObj, null, 2);
              if (hasBodyTargets || bodyWasModified) {
                  resultString = `Headers:\n${headersJson}\n\nBody:\n${bodyString}`;
              } else {
                  resultString = headersJson;
              }
          }

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
          this.notificationService.notify('Encryption script error: ' + result.error, 'error');
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
    const lang = this.activePhaseLanguage();
    if (name === '+ Add New Script') {
        const scriptName = await this.dialogService.prompt('Enter new script name:');
        if (scriptName) {
            const phase = this.activeScriptTab();
            const type = phase === 'preRequest' ? 'PreRequest' : phase === 'postResponse' ? 'PostRequest' : 'Test';
            const defaultContent = this.scriptManagementService.getDefaultContentForScript(type, scriptName, lang);
            const newScript = await this.scriptManagementService.createScript(type, scriptName, defaultContent, lang);
            if (newScript) {
                if (phase === 'preRequest') this.activePreRequestScriptId.set(newScript.id);
                if (phase === 'postResponse') this.activePostRequestScriptId.set(newScript.id);
                if (phase === 'test') this.activeTestScriptId.set(newScript.id);
                this.updateScript(phase, newScript.content, false);
            }
        }
        return;
    }
    const resolveSelectedContent = (s: { id: string; type: string; name: string; content: string }) => {
        let content = (s.content && s.content.trim())
            ? s.content
            : this.scriptManagementService.getDefaultContentForScript(s.type, s.name, lang);
        if (s.id.startsWith('default_') && isDefaultSkeletonCode(content) && lang === 'python') {
            content = this.scriptManagementService.getDefaultContentForScript(s.type, s.name, 'python');
        }
        return content;
    };
    if (this.activeScriptTab() === 'preRequest') {
        const s = this.preRequestScripts().find(x => x.name === name);
        if (s) {
            this.activePreRequestScriptId.set(s.id);
            this.updateScript('preRequest', resolveSelectedContent(s), false);
        }
    } else if (this.activeScriptTab() === 'postResponse') {
        const s = this.postRequestScripts().find(x => x.name === name);
        if (s) {
            this.activePostRequestScriptId.set(s.id);
            this.updateScript('postResponse', resolveSelectedContent(s), false);
        }
    } else if (this.activeScriptTab() === 'test') {
        const s = this.testScripts().find(x => x.name === name);
        if (s) {
            this.activeTestScriptId.set(s.id);
            this.updateScript('test', resolveSelectedContent(s), false);
        }
    }
  }

  isRunningPhaseScript = signal(false);

  activePhaseLanguage = computed<ScriptLanguage>(() => {
    const tab = this.activeScriptTab();
    const s = this.scripts();
    if (tab === 'preRequest') return s.preRequestLanguage || detectScriptLanguage(s.preRequest || '');
    if (tab === 'postResponse') return s.postResponseLanguage || detectScriptLanguage(s.postResponse || '');
    return s.testScriptLanguage || detectScriptLanguage(s.testScript || '');
  });

  activeEncryptionLanguage = computed<ScriptLanguage>(() => {
    const enc = this.encryption();
    return enc.scriptLanguage || detectScriptLanguage(enc.script || '');
  });

  setPhaseScriptLanguage(lang: ScriptLanguage) {
    const tab = this.activeScriptTab();
    const currentScripts = this.scripts();
    const phaseType = tab === 'preRequest' ? 'PreRequest' : tab === 'postResponse' ? 'PostRequest' : 'Test';
    const currentCode = tab === 'preRequest'
      ? currentScripts.preRequest
      : tab === 'postResponse'
        ? currentScripts.postResponse
        : currentScripts.testScript;
    const activeName = tab === 'preRequest'
      ? this.activePreRequestScriptName
      : tab === 'postResponse'
        ? this.activePostRequestScriptName
        : this.activeTestScriptName;
    const langField = tab === 'preRequest'
      ? 'preRequestLanguage'
      : tab === 'postResponse'
        ? 'postResponseLanguage'
        : 'testScriptLanguage';
    const codeField = tab === 'test' ? 'testScript' : tab;

    const patch: Record<string, any> = { [langField]: lang };
    if (!currentCode || !currentCode.trim() || isDefaultSkeletonCode(currentCode)) {
      patch[codeField] = this.scriptManagementService.getDefaultContentForScript(phaseType, activeName, lang);
    }
    this.tabStateService.updateState(this.tabId(), { scripts: { ...currentScripts, ...patch } });
  }

  setEncryptionScriptLanguage(lang: ScriptLanguage) {
    const currentEnc = this.encryption();
    const patch: Partial<EncryptionState> = { scriptLanguage: lang };
    if (!currentEnc.script || !currentEnc.script.trim() || isDefaultSkeletonCode(currentEnc.script)) {
      patch.script = this.scriptManagementService.getDefaultContentForScript('Encryption', this.activeEncryptionScriptName, lang);
    }
    this.tabStateService.updateState(this.tabId(), { encryption: { ...currentEnc, ...patch } });
  }

  // Response -> Request Field Direct Linking state
  linkTargetType = signal<RequestFieldTarget>('body');
  linkTargetField = signal<string>('');
  linkSourcePath = signal<string>('');
  linkTargetOptions: Array<{ value: RequestFieldTarget; label: string }> = [
    { value: 'body', label: 'Body' },
    { value: 'param', label: 'Param' },
    { value: 'query', label: 'Query' },
    { value: 'header', label: 'Header' }
  ];

  responseFieldSuggestions = computed<string[]>(() => {
    const st = this.tabState();
    const bodySuggestions = collectJsonFieldPaths(st?.responseBody, '', 30);
    const hdrSuggestions = (st?.responseHeaders || [])
      .filter(h => h && h.key)
      .slice(0, 12)
      .map(h => `responseHeaders.${h.key}`);
    return Array.from(new Set([...bodySuggestions, ...hdrSuggestions]));
  });

  requestFieldSuggestions = computed<string[]>(() => {
    const target = this.linkTargetType();
    const st = this.tabState();
    if (!st) return [];
    if (target === 'header') {
      return Array.from(new Set((st.headers || []).map(h => (h.key || '').trim()).filter(Boolean)));
    }
    if (target === 'param' || target === 'query') {
      return Array.from(new Set((st.params || []).map(p => (p.key || '').trim()).filter(Boolean)));
    }
    if (st.bodyType === 'form-data') {
      return Array.from(new Set((st.formData || []).map(f => (f.key || '').trim()).filter(Boolean)));
    }
    if (st.bodyType === 'x-www-form-urlencoded') {
      return Array.from(new Set((st.urlEncodedData || []).map(u => (u.key || '').trim()).filter(Boolean)));
    }
    return collectJsonFieldPaths(st.rawBodyJson || st.rawBody || '{}', '', 30);
  });

  private insertCodeBlockIntoScript(code: string, snippetLine: string, lang: ScriptLanguage, emptyFallbackType: string, emptyFallbackName: string): string {
    const base = (!code || !code.trim())
      ? this.scriptManagementService.getDefaultContentForScript(emptyFallbackType, emptyFallbackName, lang)
      : code;

    if (lang === 'python') {
      if (/^[ \t]+pass\s*$/m.test(base)) {
        return base.replace(/^[ \t]+pass\s*$/m, snippetLine);
      }
      if (/^[ \t]+return\s+passed\b/m.test(base)) {
        return base.replace(/^[ \t]+return\s+passed\b/m, `${snippetLine}\n    return passed`);
      }
      return `${base.trimEnd()}\n${snippetLine}`;
    }

    if (base.includes('return passed;')) {
      return base.replace('return passed;', `${snippetLine}\n    return passed;`);
    }
    const lastBrace = base.lastIndexOf('}');
    if (lastBrace !== -1) {
      return base.slice(0, lastBrace).trimEnd() + `\n${snippetLine}\n` + base.slice(lastBrace);
    }
    return `${base}\n${snippetLine}`;
  }

  insertResponseFieldLinkCode() {
    const field = this.linkTargetField().trim();
    const sourceExpr = this.linkSourcePath().trim() || 'data.token';
    if (!field) {
      this.notificationService.notify('Enter the destination request field name or path first.', 'warning');
      return;
    }
    const phase = this.activeScriptTab();
    const lang = this.activePhaseLanguage();
    const codeLine = buildFieldLinkCodeSnippet({
      target: this.linkTargetType(),
      field,
      sourceExpr,
      language: lang
    });
    const current = this.scripts();
    const curCode = phase === 'preRequest'
      ? current.preRequest
      : phase === 'postResponse'
        ? current.postResponse
        : current.testScript;
    const phaseType = phase === 'preRequest' ? 'PreRequest' : phase === 'postResponse' ? 'PostRequest' : 'Test';
    const activeName = phase === 'preRequest'
      ? this.activePreRequestScriptName
      : phase === 'postResponse'
        ? this.activePostRequestScriptName
        : this.activeTestScriptName;
    const nextCode = this.insertCodeBlockIntoScript(curCode, codeLine, lang, phaseType, activeName);
    this.updateScript(phase, nextCode, true);
    this.notificationService.notify(`Inserted ${lang === 'python' ? 'Python' : 'JS'} link to ${this.linkTargetType()}.${field}`);
  }

  populateRequestFieldFromResponse() {
    const state = this.tabState();
    if (!state) return;
    const field = this.linkTargetField().trim();
    const sourcePath = this.linkSourcePath().trim();
    if (!field || !sourcePath) {
      this.notificationService.notify('Specify both response path and target request field.', 'warning');
      return;
    }

    let extracted = /^(?:responseHeaders\.|response_headers\.)/i.test(sourcePath)
      ? extractValueByPath(state.responseHeaders || [], sourcePath)
      : extractValueByPath(state.responseBody, sourcePath);

    if (extracted === undefined && state.responseHeaders?.length) {
      extracted = extractValueByPath(state.responseHeaders, sourcePath);
    }

    if (extracted === undefined) {
      this.notificationService.notify(`No value found at response path "${sourcePath}". Send a request first or check the path.`, 'warning');
      return;
    }

    const patch = applyRequestFieldLinksToTabState(state, [
      { target: this.linkTargetType(), field, value: extracted }
    ]);
    if (Object.keys(patch).length > 0) {
      this.tabStateService.updateState(this.tabId(), patch);
      const preview = typeof extracted === 'string' ? extracted : JSON.stringify(extracted);
      const shortPreview = preview.length > 48 ? `${preview.slice(0, 45)}...` : preview;
      this.notificationService.notify(`Populated ${this.linkTargetType()} "${field}" = ${shortPreview}`, 'success');
    }
  }

  async runCurrentPhaseScript() {
      const state = this.tabState();
      if (!state) return;
      const phase = this.activeScriptTab();
      const lang = this.activePhaseLanguage();
      const rawCode = this.getScriptContent() || '';
      const code = this.variableService.resolveScript(rawCode);
      if (!code.trim()) return;

      this.isRunningPhaseScript.set(true);
      try {
          const envVars: Record<string, string> = {};
          const activeEnv = this.environmentService.activeEnvironment();
          for (const v of activeEnv?.variables || []) {
              if (v.enabled && v.key?.trim()) envVars[v.key.trim()] = v.value ?? '';
          }
          const capsuleVars: Record<string, string> = {};
          for (const v of this.variableService.variables()) {
              if (v.enabled && v.key?.trim()) capsuleVars[v.key.trim()] = v.value ?? '';
          }

          const prepared = buildEncryptionPayloadContext({
              bodyType: state.bodyType || 'none',
              rawType: state.rawType || 'JSON',
              rawBodyJson: state.rawBodyJson ? this.variableService.resolveJson(state.rawBodyJson) : undefined,
              rawBodyXml: state.rawBodyXml ? this.variableService.resolve(state.rawBodyXml) : undefined,
              rawBodyText: state.rawBodyText ? this.variableService.resolve(state.rawBodyText) : undefined,
              rawBody: state.rawBody ? this.variableService.resolve(state.rawBody) : undefined,
              formData: state.formData || [],
              urlEncodedData: state.urlEncodedData || [],
              graphqlQuery: state.graphqlQuery || '',
              graphqlVariables: state.graphqlVariables || '{}'
          });

          const context = {
              url: state.url || '',
              method: state.method || 'GET',
              headers: (state.headers || []).filter(h => h.enabled && h.key),
              body: prepared.body,
              params: (state.params || []).filter(p => p.enabled && p.key),
              bodyType: prepared.bodyType,
              rawType: prepared.rawType,
              formData: prepared.formData,
              urlEncodedData: prepared.urlEncodedData,
              graphql: prepared.graphql,
              rawText: prepared.rawText,
              responseStatus: state.responseStatus ?? 200,
              responseTime: state.responseTime ?? 0,
              responseBody: state.responseBody ?? null,
              responseHeaders: state.responseHeaders ?? [],
              responseHeader: state.responseHeaders ?? [],
              __envVars: envVars,
              __capsuleVars: capsuleVars
          };

          const result = await this.sandboxService.executeScript(code, context, lang);
          const curScripts = this.scripts();
          const consoleKey = phase === 'preRequest' ? 'preRequestConsole' : 'postResponseConsole';
          const outLogs = result.logs || (result.error ? `Error:\n${result.error}` : 'Executed cleanly with no console output.');

          if (result.context && typeof result.context === 'object') {
              const envSet = result.context['__envSet'];
              if (envSet && typeof envSet === 'object') {
                  for (const [k, v] of Object.entries(envSet)) {
                      if (k) this.environmentService.setActiveVariable(k, String(v ?? ''));
                  }
              }
              const envUnset = result.context['__envUnset'];
              if (Array.isArray(envUnset)) {
                  for (const k of envUnset) {
                      if (typeof k === 'string' && k) this.environmentService.unsetActiveVariable(k);
                  }
              }
              const varSet = result.context['__varSet'];
              if (varSet && typeof varSet === 'object') {
                  for (const [k, v] of Object.entries(varSet)) {
                      if (k) this.variableService.addVariable(k, String(v ?? ''), undefined, 'global');
                  }
              }

              const fieldLinks = result.context['__requestFieldLinks'] as RequestFieldLinkMutation[] | undefined;
              if (Array.isArray(fieldLinks) && fieldLinks.length > 0) {
                  const latest = this.tabState() || state;
                  const linkPatch = applyRequestFieldLinksToTabState(latest, fieldLinks);
                  if (Object.keys(linkPatch).length > 0) {
                      this.tabStateService.updateState(this.tabId(), linkPatch);
                  }
              }

              const nextTestResults = Array.isArray(result.context['testResults']) && phase === 'test'
                  ? result.context['testResults']
                  : undefined;

              this.tabStateService.updateState(this.tabId(), {
                  ...(nextTestResults ? { testResults: nextTestResults } : {}),
                  scripts: {
                      ...this.scripts(),
                      [consoleKey]: result.error ? `Error:\n${result.error}\n\nLogs:\n${result.logs || ''}` : outLogs
                  }
              });
          } else {
              this.tabStateService.updateState(this.tabId(), {
                  scripts: { ...curScripts, [consoleKey]: outLogs }
              });
          }

          if (result.success) {
              this.notificationService.notify(`${lang === 'python' ? 'Python' : 'JavaScript'} script executed cleanly.`, 'success');
          } else {
              this.notificationService.notify('Script error: ' + (result.error || 'Unknown error'), 'error');
          }
      } finally {
          this.isRunningPhaseScript.set(false);
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

    const lang = this.activePhaseLanguage();
    const snippetCode = (lang === 'python' && snippet.pythonCode) ? snippet.pythonCode : snippet.code;
    const currentScript = phase === 'preRequest' ? this.scripts().preRequest : this.scripts().postResponse;
    const phaseType = phase === 'preRequest' ? 'PreRequest' : 'PostRequest';
    const activeName = phase === 'preRequest' ? this.activePreRequestScriptName : this.activePostRequestScriptName;

    const updatedScript = this.insertCodeBlockIntoScript(currentScript, snippetCode, lang, phaseType, activeName);
    this.updateScript(phase, updatedScript, true);

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
  tokenVisibilityOverride = signal<boolean | null>(null);
  isTokenVisible = computed(() => {
    const override = this.tokenVisibilityOverride();
    if (override !== null) {
      return override;
    }
    const token = (this.auth()?.token ?? '').trimStart();
    return token.startsWith('{');
  });
  isRunningEncryptionScript = signal(false);

  tabId = input.required<string>();
  tabState = computed(() => this.tabStateService.getState(this.tabId()));

  payloadType = computed(() => this.tabState()?.payloadType ?? 'params');
  params = computed(() => this.tabState()?.params ?? []);
  headers = computed(() => this.tabState()?.headers ?? []);
  auth = computed(() => this.tabState()?.auth ?? { type: 'none' as const, token: '' });
  scripts = computed(() => this.tabState()?.scripts ?? { preRequest: '', postResponse: '', preRequestConsole: '', postResponseConsole: '', encryptionConsole: '', testScript: '', testScriptEnabled: false });
  encryption = computed(() => this.tabState()?.encryption ?? { algorithm: 'none' as const, key: '', autoEncryptBody: false, autoEncryptHeaders: false, encryptedHeaders: [], encryptedBodyPaths: [], script: '' });
  settings = computed(() => this.tabState()?.settings ?? { followRedirects: true, verifySsl: false, enableCookies: true, bypassCors: true });

  setPayloadType(type: string) {
    this.tabStateService.updateState(this.tabId(), { payloadType: type });
  }

  private updateKVField(field: 'params' | 'headers', index: number, key: keyof KeyValue, val: string | boolean) {
    const rows = [...(this.tabState()?.[field] ?? [])] as KeyValue[];
    if (index < 0 || index >= rows.length) return;
    const row = rows[index];
    const oldKey = row.key;
    if (key === 'enabled') rows[index] = { ...row, enabled: val as boolean };
    else if (key === 'key') rows[index] = { ...row, key: val as string };
    else if (key === 'value') rows[index] = { ...row, value: val as string };

    const patch: Record<string, any> = { [field]: rows };

    // Keep encryptedHeaders synchronized when a header key is edited or added while autoEncryptHeaders is active
    if (field === 'headers' && key === 'key') {
      const currentEnc = this.encryption();
      const newKeyStr = (val as string) || '';
      const encList = [...(currentEnc.encryptedHeaders || [])];
      const oldIdx = oldKey ? encList.findIndex(k => k === oldKey || k.trim() === oldKey.trim()) : -1;

      if (oldIdx !== -1) {
        if (newKeyStr.trim()) {
          encList[oldIdx] = newKeyStr;
        } else {
          encList.splice(oldIdx, 1);
        }
        patch['encryption'] = { ...currentEnc, encryptedHeaders: Array.from(new Set(encList)) };
      } else if (currentEnc.autoEncryptHeaders && newKeyStr.trim()) {
        encList.push(newKeyStr);
        patch['encryption'] = { ...currentEnc, encryptedHeaders: Array.from(new Set(encList)) };
      }
    }

    this.tabStateService.updateState(this.tabId(), patch);
  }

  // ── Params ───────────────────────────────────────────────────────────
  addKeyValueToVariable(key: string, value: string, type: 'param' | 'header' = 'param') {
    const state = this.tabState();
    this.variableService.openAddModal(key || '', value || '', {
      tabId: this.tabId(),
      requestId: state?.id,
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
    const currentRows = this.headers();
    const deletedKey = currentRows[i]?.key;
    const rows = currentRows.filter((_, idx) => idx !== i);
    const finalRows: KeyValue[] = rows.length ? rows : [{ enabled: true, key: '', value: '' }];
    const patch: Record<string, any> = { headers: finalRows };

    if (deletedKey) {
      const currentEnc = this.encryption();
      const remainingKeys = new Set(finalRows.filter(r => r.key && r.key.trim()).map(r => r.key.trim().toLowerCase()));
      const filteredEnc = (currentEnc.encryptedHeaders || []).filter(
        k => k !== deletedKey && k.trim() !== deletedKey.trim() && remainingKeys.has(k.trim().toLowerCase())
      );
      patch['encryption'] = {
        ...currentEnc,
        encryptedHeaders: filteredEnc,
        autoEncryptHeaders: filteredEnc.length > 0 ? currentEnc.autoEncryptHeaders : false
      };
    }

    this.tabStateService.updateState(this.tabId(), patch);
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
    const currentEnc = this.encryption();
    const patch: Record<string, any> = { headers: parsed };
    if (currentEnc.autoEncryptHeaders) {
      patch['encryption'] = {
        ...currentEnc,
        encryptedHeaders: parsed.filter(h => h.key && h.key.trim() !== '').map(h => h.key)
      };
    }
    this.tabStateService.updateState(this.tabId(), patch);
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
    const updated: AuthState = {
      ...current,
      type,
      token: current.token || '',
      oauth2: current.oauth2 || {
        grantType: 'client_credentials',
        accessTokenUrl: '',
        clientId: '',
        clientSecret: '',
        scope: '',
        headerPrefix: 'Bearer'
      },
      awsSigV4: current.awsSigV4 || {
        accessKey: '',
        secretKey: '',
        region: 'us-east-1',
        service: 'execute-api',
        sessionToken: ''
      }
    };
    this.tabStateService.updateState(this.tabId(), { auth: updated });
  }

  updateAuth(field: keyof Omit<AuthState, 'type' | 'oauth2' | 'awsSigV4'>, val: string) {
    if (field === 'token') {
      const trimmed = val.trimStart();
      if (trimmed.startsWith('{')) {
        this.tokenVisibilityOverride.set(true);
      } else {
        this.tokenVisibilityOverride.set(false);
      }
    }
    const current = this.auth();
    const updated: AuthState = { ...current, [field]: val };
    this.tabStateService.updateState(this.tabId(), { auth: updated });
  }

  updateOAuth2(field: keyof OAuth2Config, val: string) {
    const current = this.auth();
    const existing: OAuth2Config = current.oauth2 || {
      grantType: 'client_credentials',
      accessTokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      headerPrefix: 'Bearer'
    };
    this.tabStateService.updateState(this.tabId(), {
      auth: { ...current, oauth2: { ...existing, [field]: val } }
    });
  }

  updateAwsSigV4(field: keyof AwsSigV4Config, val: string) {
    const current = this.auth();
    const existing: AwsSigV4Config = current.awsSigV4 || {
      accessKey: '',
      secretKey: '',
      region: 'us-east-1',
      service: 'execute-api',
      sessionToken: ''
    };
    this.tabStateService.updateState(this.tabId(), {
      auth: { ...current, awsSigV4: { ...existing, [field]: val } }
    });
  }

  async fetchOAuth2Token() {
    const cfg = this.auth().oauth2;
    const rawUrl = cfg?.accessTokenUrl ? this.variableService.resolve(cfg.accessTokenUrl).trim() : '';
    if (!rawUrl) {
      this.notificationService.notify('Please enter an Access Token URL first.', 'warning');
      return;
    }

    this.isFetchingOAuth2Token.set(true);
    try {
      const form = new URLSearchParams();
      form.set('grant_type', cfg?.grantType || 'client_credentials');
      if (cfg?.clientId) form.set('client_id', this.variableService.resolve(cfg.clientId));
      if (cfg?.clientSecret) form.set('client_secret', this.variableService.resolve(cfg.clientSecret));
      if (cfg?.scope) form.set('scope', this.variableService.resolve(cfg.scope));
      if (cfg?.grantType === 'password') {
        if (cfg.username) form.set('username', this.variableService.resolve(cfg.username));
        if (cfg.password) form.set('password', this.variableService.resolve(cfg.password));
      }

      const bodyStr = form.toString();
      const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      let parsed: any = null;

      if (this.isElectron && electronApi?.executeHttpRequest) {
        const res = await electronApi.executeHttpRequest({
          url: rawUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body: bodyStr,
          verifySsl: false,
          followRedirects: true
        });
        if (!res?.ok) throw new Error(res?.errorMessage || 'Failed to fetch OAuth2 token.');
        parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
      } else {
        try {
          parsed = await firstValueFrom(
            this.http.post<any>(rawUrl, bodyStr, {
              headers: new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' })
            })
          );
        } catch {
          const proxyRes = await firstValueFrom(
            this.http.post<any>(environment.proxyUrl, {
              url: rawUrl,
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
              body: bodyStr,
              verifySsl: false
            })
          );
          const inner = proxyRes?.data ?? proxyRes;
          parsed = typeof inner?.body === 'string' ? JSON.parse(inner.body) : (inner?.body ?? inner);
        }
      }

      const accessToken = parsed?.access_token || parsed?.token || parsed?.id_token;
      if (!accessToken) {
        throw new Error('Response did not contain an access_token field.');
      }
      this.updateAuth('token', String(accessToken));
      this.notificationService.notify('OAuth 2.0 access token fetched and applied!', 'success');
    } catch (err: any) {
      this.notificationService.notify(err?.message || 'Failed to fetch OAuth 2.0 access token.', 'error');
    } finally {
      this.isFetchingOAuth2Token.set(false);
    }
  }

  toggleTokenVisibility() {
    this.tokenVisibilityOverride.set(!this.isTokenVisible());
  }

  // ── Scripts ──────────────────────────────────────────────────────────
  updateScript(phase: 'preRequest' | 'postResponse' | 'test', code: string, persistToService = true) {
    const current = this.scripts();
    if (phase === 'test') {
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, testScript: code } });
      const activeId = this.activeTestScriptId();
      if (persistToService && activeId && this.activeTestScriptName !== 'Select Script...' && this.activeTestScriptName !== '+ Add New Script') {
          this.saveScriptSubject.next({ id: activeId, name: this.activeTestScriptName, content: code });
      }
    } else {
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, [phase]: code } });
      const activeId = phase === 'preRequest' ? this.activePreRequestScriptId() : this.activePostRequestScriptId();
      const activeName = phase === 'preRequest' ? this.activePreRequestScriptName : this.activePostRequestScriptName;
      if (persistToService && activeId && activeName !== 'Select Script...' && activeName !== '+ Add New Script') {
          this.saveScriptSubject.next({ id: activeId, name: activeName, content: code });
      }
    }
  }

  async resetScript() {
    const current = this.scripts();
    const tab = this.activeScriptTab();
    const lang = this.activePhaseLanguage();
    if (tab === 'test') {
      const activeId = this.activeTestScriptId();
      if (activeId) {
          const resetDto = await this.scriptManagementService.resetScript(activeId, lang);
          if (resetDto) {
              this.tabStateService.updateState(this.tabId(), { scripts: { ...current, testScript: resetDto.content } });
              return;
          }
      }
      const defaultScript = this.scriptManagementService.getDefaultContentForScript('Test', this.activeTestScriptName, lang);
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, testScript: defaultScript } });
    } else {
      const activeId = tab === 'preRequest' ? this.activePreRequestScriptId() : this.activePostRequestScriptId();
      const phaseType = tab === 'preRequest' ? 'PreRequest' : 'PostRequest';
      const activeName = tab === 'preRequest' ? this.activePreRequestScriptName : this.activePostRequestScriptName;
      if (activeId) {
          const resetDto = await this.scriptManagementService.resetScript(activeId, lang);
          if (resetDto) {
              this.tabStateService.updateState(this.tabId(), { scripts: { ...current, [tab]: resetDto.content } });
              return;
          }
      }
      const defaultScript = this.scriptManagementService.getDefaultContentForScript(phaseType, activeName, lang);
      this.tabStateService.updateState(this.tabId(), { scripts: { ...current, [tab]: defaultScript } });
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

    const lang = this.activePhaseLanguage();
    const snippetCode = (lang === 'python' && snippet.pythonCode) ? snippet.pythonCode : snippet.code;
    const currentScript = this.scripts().testScript || '';
    const updatedScript = this.insertCodeBlockIntoScript(currentScript, snippetCode, lang, 'Test', this.activeTestScriptName);

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
    if (tab === 'test') return this.scripts().testScript;
    return '';
  }

  async resetEncryptionScript() {
    const id = this.activeEncryptionScriptId();
    const lang = this.activeEncryptionLanguage();
    if (id) {
        const resetDto = await this.scriptManagementService.resetScript(id, lang);
        if (resetDto) {
            this.setEncryptionField('script', resetDto.content, false);
            return;
        }
    }
    const defaultScript = this.scriptManagementService.getDefaultContentForScript('Encryption', this.activeEncryptionScriptName, lang);
    this.setEncryptionField('script', defaultScript, false);
  }

  get isDefaultEncryptionScript(): boolean {
    const id = this.activeEncryptionScriptId();
    if (!id || id.startsWith('default_')) return true;
    const s = this.encryptionScripts().find(x => x.id === id);
    return !!s?.isDefault || this.scriptManagementService.isBuiltInDefaultScript(s?.type || 'Encryption', s?.name, s?.isDefault, id);
  }

  get isDefaultPhaseScript(): boolean {
    const phase = this.activeScriptTab();
    const id = phase === 'preRequest' ? this.activePreRequestScriptId() : phase === 'postResponse' ? this.activePostRequestScriptId() : this.activeTestScriptId();
    if (!id || id.startsWith('default_')) return true;
    const all = phase === 'preRequest' ? this.preRequestScripts() : phase === 'postResponse' ? this.postRequestScripts() : this.testScripts();
    const s = all.find(x => x.id === id);
    const type = phase === 'preRequest' ? 'PreRequest' : phase === 'postResponse' ? 'PostRequest' : 'Test';
    return !!s?.isDefault || this.scriptManagementService.isBuiltInDefaultScript(type, s?.name, s?.isDefault, id);
  }

  get hasActivePhaseScript(): boolean {
    const phase = this.activeScriptTab();
    const id = phase === 'preRequest' ? this.activePreRequestScriptId() : phase === 'postResponse' ? this.activePostRequestScriptId() : this.activeTestScriptId();
    return !!id;
  }

  async deleteEncryptionScript() {
    const activeId = this.activeEncryptionScriptId();
    if (activeId && !this.isDefaultEncryptionScript) {
        const confirmed = await this.dialogService.confirm('Are you sure you want to delete this encryption script?');
        if (confirmed) {
            const success = await this.scriptManagementService.deleteScript(activeId);
            if (success) {
                const fallback = this.encryptionScripts().find(s => s.id === 'default_encrypt_fallback') || this.encryptionScripts()[0];
                if (fallback) {
                    this.activeEncryptionScriptId.set(fallback.id);
                    this.setEncryptionField('script', fallback.content);
                } else {
                    this.activeEncryptionScriptId.set('');
                    this.setEncryptionField('script', '');
                }
            }
        }
    }
  }

  async deletePhaseScript() {
      const phase = this.activeScriptTab();
      const activeId = phase === 'preRequest' ? this.activePreRequestScriptId() : phase === 'postResponse' ? this.activePostRequestScriptId() : this.activeTestScriptId();
      if (activeId) {
          const confirmed = await this.dialogService.confirm('Are you sure you want to delete this script?');
          if (confirmed) {
              const success = await this.scriptManagementService.deleteScript(activeId);
              if (success) {
                  if (phase === 'preRequest' && this.preRequestScripts().length > 0) {
                      this.activePreRequestScriptId.set(this.preRequestScripts()[0].id);
                      this.updateScript(phase, this.preRequestScripts()[0].content);
                  } else if (phase === 'postResponse' && this.postRequestScripts().length > 0) {
                      this.activePostRequestScriptId.set(this.postRequestScripts()[0].id);
                      this.updateScript(phase, this.postRequestScripts()[0].content);
                  } else if (phase === 'test' && this.testScripts().length > 0) {
                      this.activeTestScriptId.set(this.testScripts()[0].id);
                      this.updateScript(phase, this.testScripts()[0].content);
                  } else {
                      if (phase === 'preRequest') this.activePreRequestScriptId.set('');
                      if (phase === 'postResponse') this.activePostRequestScriptId.set('');
                      if (phase === 'test') this.activeTestScriptId.set('');
                      this.updateScript(phase, '');
                  }
              }
          }
      }
  }

  // ── Encryption ───────────────────────────────────────────────────────
  setEncryptionField(field: keyof EncryptionState, value: any, persistToService = true) {
    const current = this.encryption();
    this.tabStateService.updateState(this.tabId(), {
      encryption: { ...current, [field]: value }
    });
    if (field === 'script' && persistToService) {
        const activeId = this.activeEncryptionScriptId();
        const activeName = this.activeEncryptionScriptName;
        if (activeId && activeName !== 'Select Script...' && activeName !== '+ Add New Script') {
            this.saveScriptSubject.next({ id: activeId, name: activeName, content: value });
        }
    }
  }

  isHeaderEncrypted(key: string): boolean {
    if (!key || !key.trim()) return false;
    const current = this.encryption();
    if (current.autoEncryptHeaders) return true;
    const target = key.trim().toLowerCase();
    return (current.encryptedHeaders || []).some(k => k.trim().toLowerCase() === target);
  }

  hasEncryptedHeaders(): boolean {
    const current = this.encryption();
    if (current.autoEncryptHeaders) return true;
    const encList = current.encryptedHeaders || [];
    if (encList.length === 0) return false;
    const validHeaders = this.headers().filter(h => h.key && h.key.trim() !== '');
    if (validHeaders.length === 0) return encList.length > 0;
    return validHeaders.some(h => encList.some(ek => ek.trim().toLowerCase() === h.key.trim().toLowerCase()));
  }

  toggleAutoEncryptHeaders() {
    const current = this.encryption();
    const validHeaderKeys = this.headers()
      .filter(h => h.key && h.key.trim() !== '')
      .map(h => h.key);

    const isCurrentlyActive = this.hasEncryptedHeaders();
    const newEncryptedHeaders = isCurrentlyActive ? [] : validHeaderKeys;
    const newAutoEncrypt = !isCurrentlyActive;

    this.tabStateService.updateState(this.tabId(), {
      encryption: {
        ...current,
        encryptedHeaders: newEncryptedHeaders,
        autoEncryptHeaders: newAutoEncrypt
      }
    });
  }

  toggleHeaderEncryption(key: string) {
    if (!key) return;
    const current = this.encryption();
    const targetLower = key.trim().toLowerCase();
    let encList = [...(current.encryptedHeaders || [])];

    if (current.autoEncryptHeaders && encList.length === 0) {
      encList = this.headers()
        .filter(h => h.key && h.key.trim() !== '')
        .map(h => h.key);
    }

    const exists = encList.some(k => k.trim().toLowerCase() === targetLower);
    if (exists) {
      encList = encList.filter(k => k.trim().toLowerCase() !== targetLower);
    } else {
      encList.push(key);
    }

    const validHeaderKeys = this.headers()
      .filter(h => h.key && h.key.trim() !== '')
      .map(h => h.key.trim().toLowerCase());
    const allSelected = validHeaderKeys.length > 0 && validHeaderKeys.every(vk => encList.some(ek => ek.trim().toLowerCase() === vk));

    this.tabStateService.updateState(this.tabId(), {
      encryption: {
        ...current,
        encryptedHeaders: encList,
        autoEncryptHeaders: allSelected
      }
    });
  }

  // ── Settings ─────────────────────────────────────────────────────────
  timeoutInputRef = viewChild<ElementRef<HTMLInputElement>>('timeoutInputEl');
  requestTimeoutMs = this.tabStateService.requestTimeoutMs;
  requestTimeoutLabel = computed(() => formatTimeoutLabel(this.requestTimeoutMs()));
  timeoutInputDraft = signal<string>(String(this.tabStateService.requestTimeoutMs()));
  isTimeoutInputFocused = signal<boolean>(false);
  requestTimeoutPresets = [
    { label: '5s', ms: 5000 },
    { label: '15s', ms: 15000 },
    { label: '30s', ms: 30000 },
    { label: '60s', ms: 60000 },
    { label: '120s', ms: 120000 },
    { label: '∞', ms: 0 }
  ];

  private readonly syncTimeoutDraftEffect = effect(() => {
    const ms = this.requestTimeoutMs();
    if (!this.isTimeoutInputFocused()) {
      const text = String(ms);
      this.timeoutInputDraft.set(text);
      const el = this.timeoutInputRef()?.nativeElement;
      if (el && el.value !== text) {
        el.value = text;
      }
    }
  });

  selectTimeoutPreset(ms: number) {
    this.isTimeoutInputFocused.set(false);
    this.tabStateService.setRequestTimeoutMs(ms);
    const text = String(this.tabStateService.requestTimeoutMs());
    this.timeoutInputDraft.set(text);
    const el = this.timeoutInputRef()?.nativeElement;
    if (el) {
      el.value = text;
    }
  }

  onTimeoutInputFocus(event: FocusEvent) {
    this.isTimeoutInputFocused.set(true);
    const inputEl = event.target as HTMLInputElement | null;
    if (inputEl && inputEl.value.trim() === '0') {
      inputEl.select();
    }
  }

  updateRequestTimeoutMs(val: string | number) {
    const raw = String(val ?? '');
    this.timeoutInputDraft.set(raw);
    const parsed = parseTimeoutInputValue(raw);
    if (parsed !== null) {
      this.tabStateService.setRequestTimeoutMs(parsed);
    }
  }

  commitRequestTimeoutOnBlur(event?: Event) {
    this.isTimeoutInputFocused.set(false);
    const inputEl = (event?.target as HTMLInputElement | null) || this.timeoutInputRef()?.nativeElement || null;
    const raw = inputEl ? inputEl.value : this.timeoutInputDraft();
    const parsed = parseTimeoutInputValue(raw);
    if (parsed !== null) {
      this.tabStateService.setRequestTimeoutMs(parsed);
    }
    const cleanText = String(this.requestTimeoutMs());
    this.timeoutInputDraft.set(cleanText);
    if (inputEl && inputEl.value !== cleanText) {
      inputEl.value = cleanText;
    }
  }

  toggleSetting(field: keyof SettingsState, val: boolean) {
    const current = this.settings();
    const updated: SettingsState = { ...current, [field]: val };
    this.tabStateService.updateState(this.tabId(), { settings: updated });
  }
}





