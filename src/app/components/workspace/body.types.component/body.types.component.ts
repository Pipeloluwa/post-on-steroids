import { Component, signal, inject, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { TabStateService, FormDataRow } from '../../../shared/services/tab.state.service';
import { ChangeDetectionStrategy } from '@angular/core';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor.component/monaco-editor.component';

@Component({
  selector: 'app-body-types-component',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ScrollableSelectComponent, MatIcon, CommonModule, MonacoEditorComponent],
  templateUrl: './body.types.component.html',
  styleUrl: './body.types.component.css',
  host: {
    class: 'flex-1 flex flex-col min-h-0'
  }
})
export class BodyTypesComponent {
  private platformId = inject(PLATFORM_ID);
  isBrowser = isPlatformBrowser(this.platformId);
  tabStateService = inject(TabStateService);
  
  rawBodyContent = computed(() => {
    const state = this.tabStateService.activeTabState();
    return this.rawType() === 'JSON' ? (state?.rawBodyJson || '{}') : (state?.rawBodyXml || '');
  });

  onRawBodyChange(content: string) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    
    if (this.rawType() === 'JSON') {
       this.tabStateService.updateState(id, { rawBodyJson: content, rawBody: content });
    } else {
       this.tabStateService.updateState(id, { rawBodyXml: content, rawBody: content });
    }
  }

  bodyTypes = ['none', 'form-data', 'raw'];
  rawTypes = ['JSON', 'XML'];
  rowTypes = ['text', 'file'];

  bodyType = computed(() => this.tabStateService.activeTabState()?.bodyType ?? 'none');
  rawType = computed(() => this.tabStateService.activeTabState()?.rawType ?? 'JSON');
  formData = computed(() => this.tabStateService.activeTabState()?.formData ?? []);

  setBodyType(type: string) {
    const id = this.tabStateService.activeTabId();
    if (id) this.tabStateService.updateState(id, { bodyType: type });
  }

  selectRawType(type: string) {
    const id = this.tabStateService.activeTabId();
    if (id) {
      const state = this.tabStateService.activeTabState();
      const newRawBody = type === 'JSON' ? state?.rawBodyJson : state?.rawBodyXml;
      this.tabStateService.updateState(id, { 
        rawType: type,
        rawBody: newRawBody
      });
    }
  }

  // Form-data CRUD
  addFormDataRow() {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const rows = [...this.formData(), { enabled: true, key: '', value: '', type: 'text' as const }];
    this.tabStateService.updateState(id, { formData: rows });
  }

  deleteFormDataRow(i: number) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const rows = this.formData().filter((_, idx) => idx !== i);
    this.tabStateService.updateState(id, { formData: rows.length ? rows : [{ enabled: true, key: '', value: '', type: 'text' }] });
  }

  updateFormDataRow(i: number, field: keyof FormDataRow, val: string | boolean) {
    const id = this.tabStateService.activeTabId();
    if (!id) return;
    const rows = this.formData().map((r, idx) => idx === i ? { ...r, [field]: val } : r);
    this.tabStateService.updateState(id, { formData: rows });
  }

  setFormDataRowType(i: number, type: 'text' | 'file') {
    this.updateFormDataRow(i, 'type', type);
    if (type === 'file') {
      this.updateFormDataRow(i, 'value', ''); // Clear value if switching to file
    }
  }

  onFileSelected(i: number, event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.updateFormDataRow(i, 'value', input.files[0].name);
    }
  }
}
