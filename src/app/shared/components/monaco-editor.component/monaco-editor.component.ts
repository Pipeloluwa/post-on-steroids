import { Component, input, forwardRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NG_VALUE_ACCESSOR, ControlValueAccessor, FormsModule } from '@angular/forms';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

@Component({
  selector: 'app-monaco-editor',
  standalone: true,
  imports: [CommonModule, MonacoEditorModule, FormsModule],
  templateUrl: './monaco-editor.component.html',
  styleUrl: './monaco-editor.component.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MonacoEditorComponent),
      multi: true
    }
  ]
})
export class MonacoEditorComponent implements ControlValueAccessor {
  private platformId = inject(PLATFORM_ID);
  isBrowser = isPlatformBrowser(this.platformId);

  language = input<string>('javascript');
  readOnly = input<boolean>(false);

  value = signal<string>('');
  disabled = signal<boolean>(false);

  monacoOptions = signal<any>({
    theme: 'vs-dark', // Basic theme, can be updated with global theme
    language: this.language(),
    readOnly: this.readOnly(),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  });

  onChange: any = () => { };
  onTouch: any = () => { };

  writeValue(val: string): void {
    if (val !== undefined) {
      this.value.set(val);
    }
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouch = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    this.monacoOptions.update(opts => ({ ...opts, readOnly: isDisabled || this.readOnly() }));
  }

  onValueChange(newVal: string) {
    this.value.set(newVal);
    this.onChange(newVal);
    this.onTouch();
  }
}
