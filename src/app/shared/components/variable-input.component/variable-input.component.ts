import { Component, signal, computed, inject, ViewChild, ElementRef, forwardRef, input, output, HostListener, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { VariableService } from '../../services/variable.service';

interface TextSegment {
    text: string;
    type: 'normal' | 'global' | 'path';
    key?: string;
}

@Component({
  selector: 'app-variable-input',
  imports: [CommonModule, FormsModule],
  templateUrl: './variable-input.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => VariableInputComponent),
      multi: true
    }
  ],
  host: {
    class: 'w-full block relative'
  }
})
export class VariableInputComponent implements ControlValueAccessor {
    private variableService = inject(VariableService);
    
    placeholder = input<string>('');
    customClass = input<string>('');
    type = input<string>('text');
    
    value = signal<string>('');
    currentCursorIndex = signal<number>(0);
    selectedIndex = signal<number>(0);
    suppressSuggestions = signal<boolean>(false);
    
    variableKeys = computed(() => this.variableService.variables().map(v => v.key));
    
    onChange: (val: string) => void = () => {};
    onTouch: () => void = () => {};
    
    enter = output<void>();
    pasteEvent = output<ClipboardEvent>();

    @ViewChild('inputField') inputField!: ElementRef<HTMLInputElement>;
    @ViewChild('overlayDiv') overlayDiv!: ElementRef<HTMLDivElement>;

    charWidth = 0;
    isMouseInPopup = false;
    hoveredVariable = signal<{ key: string, val: string, type: string, x: number, y: number } | null>(null);

    parsedSegments = computed(() => {
        const val = this.value();
        if (!val) return [];
        if (this.type() === 'password') {
            return [{ text: val, type: 'normal' as const }];
        }
        
        const regex = /(\{\{.*?\}\}|:[a-zA-Z0-9_-]+)/g;
        const segments: TextSegment[] = [];
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(val)) !== null) {
            if (match.index > lastIndex) {
                segments.push({ text: val.substring(lastIndex, match.index), type: 'normal' });
            }
            const matchText = match[0];
            if (matchText.startsWith('{{')) {
                const key = matchText.substring(2, matchText.length - 2).trim();
                segments.push({ text: matchText, type: 'global', key });
            } else if (matchText.startsWith(':')) {
                const key = matchText.substring(1);
                const charBefore = match.index > 0 ? val[match.index - 1] : '/';
                if (['/', '?', '&', '='].includes(charBefore)) {
                    segments.push({ text: matchText, type: 'path', key });
                } else {
                    segments.push({ text: matchText, type: 'normal' });
                }
            }
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < val.length) {
            segments.push({ text: val.substring(lastIndex), type: 'normal' });
        }
        return segments;
    });

    suggestionState = computed(() => {
        if (this.suppressSuggestions()) {
            return { type: 'none', list: [] as string[] };
        }
        const val = this.value();
        const cursor = this.currentCursorIndex();
        const textBeforeCursor = val.substring(0, cursor);
        
        const lastOpenBracket = textBeforeCursor.lastIndexOf('{{');
        const lastCloseBracket = textBeforeCursor.lastIndexOf('}}');
        if (lastOpenBracket !== -1 && lastOpenBracket >= lastCloseBracket) {
            const searchToken = textBeforeCursor.substring(lastOpenBracket + 2);
            return {
                type: 'global',
                list: this.variableKeys().filter(k => k.toLowerCase().includes(searchToken.toLowerCase()))
            };
        }
        
        const lastColon = textBeforeCursor.lastIndexOf(':');
        if (lastColon !== -1) {
            const textAfterColon = textBeforeCursor.substring(lastColon + 1);
            if (/^[a-zA-Z0-9_-]*$/.test(textAfterColon)) {
                const charBeforeColon = lastColon > 0 ? textBeforeCursor[lastColon - 1] : '/';
                if (['/', '?', '&', '='].includes(charBeforeColon)) {
                    return {
                        type: 'path',
                        list: this.variableKeys().filter(k => k.toLowerCase().includes(textAfterColon.toLowerCase()))
                    };
                }
            }
        }
        
        return { type: 'none', list: [] as string[] };
    });

    constructor() {
        effect(() => {
            this.suggestionState();
            this.selectedIndex.set(0);
        }, { allowSignalWrites: true });
    }

    cursorOffset = computed(() => {
        const charWidth = 6.5; 
        const paddingLeft = 12;
        const modalWidth = 150;
        const offset = paddingLeft + (this.currentCursorIndex() * charWidth);
        
        if (this.inputField?.nativeElement) {
            const containerWidth = this.inputField.nativeElement.offsetWidth;
            if (containerWidth > 0 && (offset + modalWidth) > containerWidth) {
                return Math.max(0, containerWidth - modalWidth - 10);
            }
        }
        return offset;
    });

    writeValue(val: string): void {
        this.value.set(val || '');
    }

    registerOnChange(fn: (val: string) => void): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouch = fn;
    }
    
    onInput(event: Event) {
        this.suppressSuggestions.set(false);
        const inputElement = event.target as HTMLInputElement;
        const newVal = inputElement.value;
        this.value.set(newVal);
        this.onChange(newVal);
        this.updateCursorPosition();
    }
    
    onKeyDown(event: KeyboardEvent) {
        const state = this.suggestionState();
        if (state.list.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.selectedIndex.update(i => Math.min(i + 1, state.list.length - 1));
                return;
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                this.selectedIndex.update(i => Math.max(i - 1, 0));
                return;
            } else if (event.key === 'Enter') {
                event.preventDefault();
                this.setSuggestion(state.list[this.selectedIndex()]);
                return;
            }
        }

        if (event.key === 'Enter') {
            this.enter.emit();
        }
    }
    
    updateCursorPosition(): void {
        requestAnimationFrame(() => {
            if (this.inputField?.nativeElement) {
                this.currentCursorIndex.set(this.inputField.nativeElement.selectionStart ?? 0);
            }
        });
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        if (!this.inputField?.nativeElement.contains(event.target as Node)) {
            // clicked outside
        }
    }
    
    setSuggestion(suggestion: string) {
        const val = this.value();
        const cursor = this.currentCursorIndex();
        const state = this.suggestionState();
        if (state.type === 'none') return;
        
        const textBeforeCursor = val.substring(0, cursor);
        const textAfterCursor = val.substring(cursor);
        
        if (state.type === 'global') {
            const lastOpenBracket = textBeforeCursor.lastIndexOf('{{');
            if (lastOpenBracket !== -1) {
                const beforeVar = val.substring(0, lastOpenBracket + 2);
                const hasClosingBrackets = textAfterCursor.startsWith('}}');
                const hasSingleClosingBracket = textAfterCursor.startsWith('}');
                let closingStr = '}}';
                if (hasClosingBrackets) closingStr = '';
                else if (hasSingleClosingBracket) closingStr = '}';
                
                const newVal = beforeVar + suggestion + closingStr + textAfterCursor;
                this.value.set(newVal);
                this.onChange(newVal);
                
                const newCursorPos = lastOpenBracket + 2 + suggestion.length + closingStr.length;
                this.restoreFocus(newCursorPos);
            }
        } else if (state.type === 'path') {
            const lastColon = textBeforeCursor.lastIndexOf(':');
            if (lastColon !== -1) {
                const beforeVar = val.substring(0, lastColon + 1);
                const matchRest = textAfterCursor.match(/^[a-zA-Z0-9_-]*/);
                const replaceLen = matchRest ? matchRest[0].length : 0;
                const afterReplaced = textAfterCursor.substring(replaceLen);
                
                const newVal = beforeVar + suggestion + afterReplaced;
                this.value.set(newVal);
                this.onChange(newVal);
                
                const newCursorPos = lastColon + 1 + suggestion.length;
                this.restoreFocus(newCursorPos);
            }
        }
        
        this.suppressSuggestions.set(true);
    }

    private restoreFocus(newCursorPos: number) {
        requestAnimationFrame(() => {
            if (this.inputField?.nativeElement) {
                this.inputField.nativeElement.focus();
                this.inputField.nativeElement.setSelectionRange(newCursorPos, newCursorPos);
                this.currentCursorIndex.set(newCursorPos);
            }
        });
    }

    onScroll(event: Event) {
        if (this.overlayDiv?.nativeElement) {
            this.overlayDiv.nativeElement.scrollLeft = (event.target as HTMLInputElement).scrollLeft;
        }
        this.hoveredVariable.set(null);
    }

    onMouseMove(event: MouseEvent) {
        if (this.type() === 'password') {
            this.hoveredVariable.set(null);
            return;
        }
        
        const inputEl = event.target as HTMLInputElement;
        const rect = inputEl.getBoundingClientRect();
        
        if (!this.charWidth) {
            const ctx = document.createElement('canvas').getContext('2d');
            if (ctx) {
                const computedStyle = window.getComputedStyle(inputEl);
                ctx.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
                this.charWidth = ctx.measureText('a').width;
            } else {
                this.charWidth = 7.2;
            }
        }
        
        const computedStyle = window.getComputedStyle(inputEl);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const scrollLeft = inputEl.scrollLeft;
        const relativeX = event.clientX - rect.left - paddingLeft + scrollLeft;
        
        if (relativeX < 0) {
            if (!this.isMouseInPopup) this.hoveredVariable.set(null);
            return;
        }
        
        const charIndex = Math.floor(relativeX / this.charWidth);
        
        let currentIndex = 0;
        const segments = this.parsedSegments();
        let found = false;
        for (const seg of segments) {
            const nextIndex = currentIndex + seg.text.length;
            if (charIndex >= currentIndex && charIndex < nextIndex) {
                if (seg.type === 'global' || seg.type === 'path') {
                    const varX = event.clientX;
                    const varY = rect.top;
                    
                    const currentVar = this.variableService.variables().find(v => v.key === seg.key);
                    
                    this.hoveredVariable.set({
                        key: seg.key!,
                        val: currentVar ? (currentVar.value || '') : '',
                        type: seg.type,
                        x: varX,
                        y: varY
                    });
                    found = true;
                }
                break;
            }
            currentIndex = nextIndex;
        }
        
        if (!found && !this.isMouseInPopup) {
            this.hoveredVariable.set(null);
        }
    }

    onMouseLeave() {
        setTimeout(() => {
            if (!this.isMouseInPopup) {
                this.hoveredVariable.set(null);
            }
        }, 100);
    }

    updateVariableValue(key: string, newValue: string) {
        const v = this.variableService.variables().find(v => v.key === key);
        if (v) {
            this.variableService.updateVariable({ ...v, value: newValue });
        }
    }
}
