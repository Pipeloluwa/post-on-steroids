import { Component, input, forwardRef, inject, PLATFORM_ID, signal, effect } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NG_VALUE_ACCESSOR, ControlValueAccessor, FormsModule } from '@angular/forms';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

@Component({
  selector: 'app-monaco-editor',
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
  restrictToFunctionBody = input<boolean>(false);

  value = signal<string>('');
  disabled = signal<boolean>(false);

  monacoOptions = signal<Record<string, unknown>>({
    theme: 'vs-dark',
    language: this.language(),
    readOnly: this.readOnly(),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  });

  private editorInstance: unknown = null;
  private isReverting = false;
  private lastValidContent = '';

  onChange: (val: string) => void = () => { };
  onTouch: () => void = () => { };

  onEditorInit(editor: unknown) {
    this.editorInstance = editor;

    if (this.restrictToFunctionBody()) {
      this.setupFunctionBodyRestriction(editor as MonacoEditor);
    }
  }

  private setupFunctionBodyRestriction(editor: MonacoEditor) {
    this.lastValidContent = this.value();

    editor.onDidChangeModelContent(() => {
      if (this.isReverting) return;

      const model = editor.getModel();
      if (!model) return;

      const currentContent = model.getValue();
      const lines = currentContent.split('\n');

      // Validate: first line must be the function signature, last line must be closing brace
      const firstLine = lines[0];
      const lastLine = lines[lines.length - 1];

      const isFirstLineValid = /^function\s+\w+\s*\(.*\)\s*\{/.test(firstLine);
      const isLastLineValid = lastLine.trim() === '}';

      if (!isFirstLineValid || !isLastLineValid) {
        // Revert to the last valid content
        this.isReverting = true;
        model.setValue(this.lastValidContent);
        this.isReverting = false;
        return;
      }

      this.lastValidContent = currentContent;
    });
  }

  writeValue(val: string): void {
    if (val !== undefined) {
      this.value.set(val);
      this.lastValidContent = val;
    }
  }

  registerOnChange(fn: (val: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouch = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    this.monacoOptions.update(opts => ({ ...opts, readOnly: isDisabled || this.readOnly() }));
  }

  onValueChange(newVal: string) {
    this.value.set(newVal);
    this.onChange(newVal);
    this.onTouch();
  }
}

interface MonacoEditor {
  getModel(): { getValue(): string; setValue(value: string): void } | null;
  onDidChangeModelContent(listener: () => void): void;
}
