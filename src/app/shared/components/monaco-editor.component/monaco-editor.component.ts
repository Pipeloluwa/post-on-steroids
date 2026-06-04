import { Component, input, output, forwardRef, inject, PLATFORM_ID, signal, effect, computed, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NG_VALUE_ACCESSOR, ControlValueAccessor, FormsModule } from '@angular/forms';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';
import { ThemeService } from '../../services/theme.service';

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
  private themeService = inject(ThemeService);
  isBrowser = isPlatformBrowser(this.platformId);

  language = input<string>('javascript');
  readOnly = input<boolean>(false);
  wordWrap = input<boolean>(false);
  restrictToFunctionBody = input<boolean>(false);
  enableEncryptionToggles = input<boolean>(false);
  encryptedPaths = input<string[]>([]);
  autoEncrypt = input<boolean>(false);
  toggleEncryption = output<string>();

  value = signal<string>('');
  disabled = signal<boolean>(false);

  monacoOptions = computed(() => ({
    theme: this.themeService.isDarkMode() ? 'vs-dark' : 'vs',
    language: this.language(),
    readOnly: this.disabled() || this.readOnly(),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollbar: { useShadows: false },
    stickyScroll: { enabled: false },
    scrollBeyondLastLine: false,
    glyphMargin: this.enableEncryptionToggles(),
    wordWrap: this.wordWrap() ? 'on' : 'off',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  }));

  private editorInstance: any = null;
  private isReverting = false;
  private lastValidContent = '';
  private resizeObserver: ResizeObserver | null = null;
  private themeUpdateId = 0;

  constructor() {
    // Dynamically update editor options when theme changes without recreating the editor
    effect(() => {
      const theme = this.themeService.isDarkMode() ? 'vs-dark' : 'vs';
      const readOnly = this.disabled() || this.readOnly();
      const glyphMargin = this.enableEncryptionToggles();
      if (this.editorInstance) {
        const monacoGlobal = (window as any).monaco;
        if (monacoGlobal && monacoGlobal.editor) {
           monacoGlobal.editor.setTheme(theme);
        }
        this.editorInstance.updateOptions({ readOnly, glyphMargin });

        if (this.enableEncryptionToggles()) {
           this.themeUpdateId++; // Increment so class name changes
           // Re-apply decorations after a single short tick to allow the editor 
           // options (like theme) to sync up with Monaco's internal DOM structure.
           setTimeout(() => this.updateDecorations(), 50);
        }
      }
    });

    effect(() => {
      const paths = this.encryptedPaths();
      const autoEnc = this.autoEncrypt();
      if (this.editorInstance && this.enableEncryptionToggles()) {
        this.updateDecorations();
      }
    });
  }

  onChange: (val: string) => void = () => { };
  onTouch: () => void = () => { };

  onEditorInit(editor: any) {
    this.editorInstance = editor;

    if (this.restrictToFunctionBody()) {
      this.setupFunctionBodyRestriction(editor as MonacoEditor);
    }

    // Fix cursor offset: Monaco caches font character width measurements.
    // When the editor initializes in a container that hasn't fully rendered,
    // these measurements are wrong. We must:
    // 1. Call layout() to recalculate container dimensions
    // 2. Call monaco.editor.remeasureFonts() to recalculate character widths
    if (this.isBrowser && editor.layout) {
      const fixLayout = () => {
        editor.layout();
        // Access the global monaco API to force font re-measurement
        const monacoGlobal = (window as any).monaco;
        if (monacoGlobal?.editor?.remeasureFonts) {
          monacoGlobal.editor.remeasureFonts();
        }
      };

      // Use requestAnimationFrame to ensure DOM is painted before measuring
      requestAnimationFrame(() => {
        fixLayout();
        // Additional delayed fix for containers that settle after animation
        setTimeout(() => fixLayout(), 100);
        setTimeout(() => fixLayout(), 300);
      });

      // Setup ResizeObserver for ongoing layout fixes (e.g. panel resize)
      this.resizeObserver = new ResizeObserver(() => {
        editor.layout();
      });

      const container = (editor as any).getDomNode()?.parentElement;
      if (container) {
        this.resizeObserver.observe(container);
      }
    }

    if (this.enableEncryptionToggles()) {
      editor.onMouseDown((e: any) => {
        const monacoGlobal = (window as any).monaco;
        if (e.target.type === monacoGlobal.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNumber = e.target.position.lineNumber;
          const model = editor.getModel();
          if (model) {
            const lines = model.getValue().split('\n');
            const path = this.getJsonPathAtLine(lines, lineNumber - 1);
            if (path) {
              this.toggleEncryption.emit(path);
            }
          }
        }
      });

      editor.onDidChangeModelContent(() => {
        this.updateDecorations();
      });

      // Ensure decorations exist immediately after the editor mounts.
      requestAnimationFrame(() => this.updateDecorations());
    }
  }

  private decorationsCollection: any;
  private oldDecorations: string[] = [];

  private updateDecorations() {
    if (!this.editorInstance) return;
    const monacoGlobal = (window as any).monaco;
    if (!monacoGlobal) return;

    const model = this.editorInstance.getModel();
    if (!model) return;

    const lines = model.getValue().split('\n');
    const decorations: any[] = [];
    const paths = this.encryptedPaths() || [];
    const autoEnc = this.autoEncrypt();

    for (let i = 0; i < lines.length; i++) {
      const path = this.getJsonPathAtLine(lines, i);
      if (path) {
        const isEncrypted = autoEnc || paths.includes(path);
        decorations.push({
          range: new monacoGlobal.Range(i + 1, 1, i + 1, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: (isEncrypted ? 'monaco-lock-icon active ' : 'monaco-lock-icon inactive ') + `theme-sync-${this.themeUpdateId}`,
            glyphMarginHoverMessage: { value: isEncrypted ? 'Click to disable encryption' : 'Click to enable encryption' }
          }
        });
      }
    }

    if (this.editorInstance.deltaDecorations) {
      this.oldDecorations = this.editorInstance.deltaDecorations(this.oldDecorations, decorations);
    } else if (this.decorationsCollection) {
      this.decorationsCollection.set(decorations);
    } else {
      this.decorationsCollection = this.editorInstance.createDecorationsCollection(decorations);
    }
  }

  private getJsonPathAtLine(lines: string[], targetLineIndex: number): string | null {
    const targetLine = lines[targetLineIndex];
    if (!targetLine) return null;
    const keyMatch = targetLine.match(/^\s*"([^"]+)"\s*:/);
    if (!keyMatch) return null;

    const targetKey = keyMatch[1];
    const targetIndent = targetLine.search(/\S/);

    const path: string[] = [targetKey];
    let currentIndent = targetIndent;

    for (let i = targetLineIndex - 1; i >= 0; i--) {
      const line = lines[i];
      const indent = line.search(/\S/);
      if (indent !== -1 && indent < currentIndent) {
        const parentMatch = line.match(/^\s*"([^"]+)"\s*:\s*\{/);
        if (parentMatch) {
          path.unshift(parentMatch[1]);
          currentIndent = indent;
        }
      }
    }
    return path.join('.');
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
    if (val !== undefined && val !== this.value()) {
      this.value.set(val);
      this.lastValidContent = val;
      if (this.editorInstance && this.enableEncryptionToggles()) {
        this.updateDecorations();
      }
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
    if (newVal !== this.value()) {
      this.value.set(newVal);
      this.onChange(newVal);
      this.onTouch();
    }
  }
}

interface MonacoEditor {
  getModel(): { getValue(): string; setValue(value: string): void } | null;
  onDidChangeModelContent(listener: () => void): void;
}
