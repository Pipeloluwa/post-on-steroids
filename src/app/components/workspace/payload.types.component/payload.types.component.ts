import { Component, inject, computed, signal, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, KeyValue, AuthState, EncryptionState, SettingsState } from '../../../shared/services/tab.state.service';
import { VariableService } from '../../../shared/services/variable.service';
import { ChangeDetectionStrategy } from '@angular/core';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { BodyTypesComponent } from "../body.types.component/body.types.component";
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor.component/monaco-editor.component';


@Component({
  selector: 'app-payload-types-component',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIcon, ScrollableSelectComponent, BodyTypesComponent, MonacoEditorComponent],
  templateUrl: './payload.types.component.html',
  styleUrl: './payload.types.component.css',
})
export class PayloadTypesComponent {
  tabStateService = inject(TabStateService);
  variableService = inject(VariableService);

  payloadTypes = ['params', 'auth', 'headers', 'body', 'scripts', 'encryption-channel', 'settings'];
  authTypes: AuthState['type'][] = ['none', 'bearer'];
  channelNames = ['Default Channel', 'Secure Channel 1', 'Payment Gateway', 'Internal Legacy', 'Production Node', 'Staging Link', 'Encrypted Proxy', 'VPN Tunnel'];

  // State for Bulk Edit
  isRawParams = signal(false);
  isRawHeaders = signal(false);
  rawParamsText = signal('');
  rawHeadersText = signal('');

  // State for Scripts
  activeScriptTab = signal<'preRequest' | 'postResponse'>('preRequest');
  scriptOptions = ['Pre-request Script', 'Post-response Script'];

  displayScriptTab = computed(() => this.activeScriptTab() === 'preRequest' ? 'Pre-request Script' : 'Post-response Script');

  setScriptTab(option: string) {
    if (option === 'Pre-request Script') this.activeScriptTab.set('preRequest');
    else if (option === 'Post-response Script') this.activeScriptTab.set('postResponse');
  }

  // State for Auth
  isTokenVisible = signal(false);
  tokenSuggestions = signal<string[]>([]);

  @ViewChild('tokenInput') tokenInput?: ElementRef<HTMLInputElement>;

  payloadType = computed(() => this.tabStateService.activeTabState()?.payloadType ?? 'params');
  params = computed(() => this.tabStateService.activeTabState()?.params ?? []);
  headers = computed(() => this.tabStateService.activeTabState()?.headers ?? []);
  auth = computed(() => this.tabStateService.activeTabState()?.auth ?? { type: 'none' as const, token: '' });
  scripts = computed(() => this.tabStateService.activeTabState()?.scripts ?? { preRequest: '', postResponse: '', preRequestConsole: '', postResponseConsole: '' });
  encryption = computed(() => this.tabStateService.activeTabState()?.encryption ?? { algorithm: 'none' as const, key: '', autoEncrypt: false, channelName: '' });
  settings = computed(() => this.tabStateService.activeTabState()?.settings ?? { followRedirects: true, verifySsl: true, enableCookies: true });

  setPayloadType(type: string) {
    const id = this.tabStateService.activeTabId();
    if (id) this.tabStateService.updateState(id, { payloadType: type });
  }

  private updateKVField(field: 'params' | 'headers', index: number, key: keyof KeyValue, val: string | boolean) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const rows = [...(this.tabStateService.activeTabState()?.[field] ?? [])] as KeyValue[];
    if (index < 0 || index >= rows.length) return;
    const row = rows[index];
    if (key === 'enabled') rows[index] = { ...row, enabled: val as boolean };
    else if (key === 'key') rows[index] = { ...row, key: val as string };
    else if (key === 'value') rows[index] = { ...row, value: val as string };
    this.tabStateService.updateState(id, { [field]: rows });
  }

  // ── Params ───────────────────────────────────────────────────────────
  updateParam(i: number, key: keyof KeyValue, val: string | boolean) { this.updateKVField('params', i, key, val); }
  addParam() {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    this.tabStateService.updateState(id, { params: [...this.params(), { enabled: true, key: '', value: '' }] });
  }
  deleteParam(i: number) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const rows = this.params().filter((_, idx) => idx !== i);
    this.tabStateService.updateState(id, { params: rows.length ? rows : [{ enabled: true, key: '', value: '' }] });
  }

  toggleRawParams() {
    if (!this.isRawParams()) {
      this.rawParamsText.set(this.stringifyKV(this.params()));
    } else {
      this.paramsFromRaw();
    }
    this.isRawParams.update(v => !v);
  }

  private paramsFromRaw() {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const parsed = this.parseRawKV(this.rawParamsText());
    this.tabStateService.updateState(id, { params: parsed });
  }

  // ── Headers ──────────────────────────────────────────────────────────
  updateHeader(i: number, key: keyof KeyValue, val: string | boolean) { this.updateKVField('headers', i, key, val); }
  addHeader() {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    this.tabStateService.updateState(id, { headers: [...this.headers(), { enabled: true, key: '', value: '' }] });
  }
  deleteHeader(i: number) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const rows = this.headers().filter((_, idx) => idx !== i);
    this.tabStateService.updateState(id, { headers: rows.length ? rows : [{ enabled: true, key: '', value: '' }] });
  }

  toggleRawHeaders() {
    if (!this.isRawHeaders()) {
      this.rawHeadersText.set(this.stringifyKV(this.headers()));
    } else {
      this.headersFromRaw();
    }
    this.isRawHeaders.update(v => !v);
  }

  private headersFromRaw() {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const parsed = this.parseRawKV(this.rawHeadersText());
    this.tabStateService.updateState(id, { headers: parsed });
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
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const current = this.auth();
    const updated: AuthState = { type, token: current.token };
    this.tabStateService.updateState(id, { auth: updated });
  }
  updateAuth(field: keyof Omit<AuthState, 'type'>, val: string) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const current = this.auth();
    const updated: AuthState = { ...current, [field]: val };
    this.tabStateService.updateState(id, { auth: updated });

    if (field === 'token') {
      this.handleTokenChange(val);
    }
  }

  toggleTokenVisibility() {
    this.isTokenVisible.update(v => !v);
  }

  handleTokenChange(val: string) {
    const cursorPosition = this.tokenInput?.nativeElement.selectionStart || 0;
    const textBeforeCursor = val.substring(0, cursorPosition);
    const lastDoubleBraceIndex = textBeforeCursor.lastIndexOf('{{');

    if (lastDoubleBraceIndex !== -1 && !textBeforeCursor.substring(lastDoubleBraceIndex).includes('}}')) {
      const query = textBeforeCursor.substring(lastDoubleBraceIndex + 2).toLowerCase();
      const filtered = this.variableService.variables()
        .filter(v => v.key.toLowerCase().includes(query))
        .map(v => v.key);
      this.tokenSuggestions.set(filtered);
    } else {
      this.tokenSuggestions.set([]);
    }
  }

  setTokenSuggestion(suggestion: string) {
    const currentToken = this.auth().token;
    const cursorPosition = this.tokenInput?.nativeElement.selectionStart || 0;
    const textBeforeCursor = currentToken.substring(0, cursorPosition);
    const textAfterCursor = currentToken.substring(cursorPosition);
    const lastDoubleBraceIndex = textBeforeCursor.lastIndexOf('{{');

    if (lastDoubleBraceIndex !== -1) {
      const newToken = textBeforeCursor.substring(0, lastDoubleBraceIndex + 2) + suggestion + '}}' + textAfterCursor;
      this.updateAuth('token', newToken);
      this.tokenSuggestions.set([]);

      // Set focus back and move cursor
      setTimeout(() => {
        const newPos = lastDoubleBraceIndex + 2 + suggestion.length + 2;
        this.tokenInput?.nativeElement.setSelectionRange(newPos, newPos);
        this.tokenInput?.nativeElement.focus();
      });
    }
  }

  // ── Scripts ──────────────────────────────────────────────────────────
  updateScript(phase: 'preRequest' | 'postResponse', code: string) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    this.tabStateService.updateState(id, { scripts: { ...this.scripts(), [phase]: code } });
  }

  resetScript() {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const defaultState = this.tabStateService.getDefaultState(id);
    const phase = this.activeScriptTab();
    const defaultScript = defaultState.scripts[phase];
    this.updateScript(phase, defaultScript);
  }

  // ── Encryption ───────────────────────────────────────────────────────
  setEncryptionField(field: keyof EncryptionState, val: string | boolean) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const current = this.encryption();
    const updated: EncryptionState = { ...current, [field]: val };
    this.tabStateService.updateState(id, { encryption: updated });
  }

  // ── Settings ─────────────────────────────────────────────────────────
  toggleSetting(field: keyof SettingsState, val: boolean) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const current = this.settings();
    const updated: SettingsState = { ...current, [field]: val };
    this.tabStateService.updateState(id, { settings: updated });
  }
}
