import { Component, signal, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { TabStateService, FormDataRow } from '../../../shared/services/tab.state.service';
import { ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-body-types-component',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ScrollableSelectComponent, MatIcon, CommonModule],
  templateUrl: './body.types.component.html',
  styleUrl: './body.types.component.css',
})
export class BodyTypesComponent {
  tabStateService = inject(TabStateService);

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
    if (id) this.tabStateService.updateState(id, { rawType: type });
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
