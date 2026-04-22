import { Component, input, forwardRef, inject, PLATFORM_ID, signal, effect, computed } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NG_VALUE_ACCESSOR, ControlValueAccessor, FormsModule } from '@angular/forms';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

@Component({
  selector: 'app-monaco-editor',
  imports: [CommonModule, MonacoEditorModule, FormsModule],
  templateUrl: './monaco-editor.component.html',
  styleUrl: './monaco-editor.component.css',
  host: {
    class: 'w-full h-full block'
  },
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

  monacoOptions = computed(() => ({
    theme: 'vs-dark',
    language: this.language(),
    readOnly: this.disabled() || this.readOnly(),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  }));

  private editorInstance: any = null;
  private isReverting = false;
  private lastValidContent = '';
  private resizeObserver: ResizeObserver | null = null;

  onChange: (val: string) => void = () => { };
  onTouch: () => void = () => { };

  onEditorInit(editor: any) {
    this.editorInstance = editor;

    if (this.restrictToFunctionBody()) {
      this.setupFunctionBodyRestriction(editor as MonacoEditor);
    }

    // Setup ResizeObserver to fix cursor offset issues
    if (this.isBrowser && editor.layout) {
      this.resizeObserver = new ResizeObserver(() => {
        editor.layout();
      });
      
      // Get the editor container element
      const container = (editor as any).getDomNode()?.parentElement;
      if (container) {
        this.resizeObserver.observe(container);
      }
    }
  }

  ngOnDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
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
