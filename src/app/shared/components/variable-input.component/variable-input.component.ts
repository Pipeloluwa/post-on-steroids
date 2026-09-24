import { Component, signal, computed, inject, ViewChild, ElementRef, forwardRef, input, output, HostListener, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { VariableService } from '../../services/variable.service';

interface TextSegment {
    text: string;
    type: 'normal' | 'global' | 'path' | 'utility';
    key?: string;
}

const UTILITIES = [
    '$guid', '$timestamp', '$randomInt', '$randomUUID', 
    '$randomEmail', '$randomName', '$randomWord', '$randomColor', 
    '$randomCity', '$randomStreetAddress', '$randomPhoneNumber',
    '$randomBoolean', '$randomAlphaNumeric', '$randomIPv4'
];

function generateUtilityValue(utility: string): string {
    switch (utility.toLowerCase()) {
        case '$guid':
        case '$randomuuid': return crypto.randomUUID();
        case '$timestamp': return Date.now().toString();
        case '$randomint': return Math.floor(Math.random() * 1000).toString();
        case '$randomemail': return `test_${Math.floor(Math.random() * 10000)}@example.com`;
        case '$randomname': return 'John Doe';
        case '$randomword': return 'lorem';
        case '$randomcolor': return '#' + Math.floor(Math.random()*16777215).toString(16);
        case '$randomcity': return 'New York';
        case '$randomstreetaddress': return '123 Main St';
        case '$randomphonenumber': return '555-0100';
        case '$randomboolean': return Math.random() > 0.5 ? 'true' : 'false';
        case '$randomalphanumeric': return Math.random().toString(36).substring(2, 10);
        case '$randomipv4': return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
        default: return utility;
    }
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
        
        const regex = /(\{\{.*?\}\}|:[a-zA-Z0-9_-]+|\$[a-zA-Z0-9_]+)/g;
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
            } else if (matchText.startsWith('$')) {
                segments.push({ text: matchText, type: 'utility', key: matchText });
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
        const allVars = this.variableService.variables();
        
        const lastOpenBracket = textBeforeCursor.lastIndexOf('{{');
        const lastCloseBracket = textBeforeCursor.lastIndexOf('}}');
        if (lastOpenBracket !== -1 && lastOpenBracket >= lastCloseBracket) {
            const searchToken = textBeforeCursor.substring(lastOpenBracket + 2).toLowerCase();
            const globalKeys = allVars.filter(v => v.type === 'global' || !v.type).map(v => v.key);
            return {
                type: 'global',
                list: globalKeys.filter(k => k.toLowerCase().includes(searchToken))
            };
        }
        
        const lastColon = textBeforeCursor.lastIndexOf(':');
        if (lastColon !== -1) {
            const textAfterColon = textBeforeCursor.substring(lastColon + 1);
            if (/^[a-zA-Z0-9_-]*$/.test(textAfterColon)) {
                const charBeforeColon = lastColon > 0 ? textBeforeCursor[lastColon - 1] : '/';
                if (['/', '?', '&', '='].includes(charBeforeColon)) {
                    const pathKeys = allVars.filter(v => v.type === 'path').map(v => v.key);
                    return {
                        type: 'path',
                        list: pathKeys.filter(k => k.toLowerCase().includes(textAfterColon.toLowerCase()))
                    };
                }
            }
        }
        
        const lastDollar = textBeforeCursor.lastIndexOf('$');
        if (lastDollar !== -1) {
            const textAfterDollar = textBeforeCursor.substring(lastDollar); // Keep $ for matching
            if (/^\$[a-zA-Z0-9_]*$/.test(textAfterDollar)) {
                return {
                    type: 'utility',
                    list: UTILITIES.filter(k => k.toLowerCase().includes(textAfterDollar.toLowerCase()))
                };
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

    inputScrollLeft = signal<number>(0);

    cursorOffset = computed(() => {
        let charWidth = this.charWidth;
        if (!charWidth) {
            if (this.inputField?.nativeElement) {
                const ctx = document.createElement('canvas').getContext('2d');
                if (ctx) {
                    const computedStyle = window.getComputedStyle(this.inputField.nativeElement);
                    ctx.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
                    charWidth = ctx.measureText('a').width;
                    this.charWidth = charWidth;
                } else {
                    charWidth = 7.2;
                }
            } else {
                charWidth = 7.2;
            }
        }
        
        let paddingLeft = 12; // fallback
        if (this.inputField?.nativeElement) {
            const computedStyle = window.getComputedStyle(this.inputField.nativeElement);
            paddingLeft = parseFloat(computedStyle.paddingLeft) || 12;
        }

        const modalWidth = 150;
        const totalTextWidth = this.currentCursorIndex() * charWidth;
        const offset = paddingLeft + totalTextWidth - this.inputScrollLeft();
        
        if (this.inputField?.nativeElement) {
            const containerWidth = this.inputField.nativeElement.clientWidth;
            if (containerWidth > 0 && (offset + modalWidth) > containerWidth) {
                return Math.max(0, containerWidth - modalWidth - 10);
            }
        }
        return Math.max(0, offset);
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
                this.selectedIndex.update(i => {
                    const newIndex = Math.min(i + 1, state.list.length - 1);
                    this.scrollToSuggestion(newIndex);
                    return newIndex;
                });
                return;
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                this.selectedIndex.update(i => {
                    const newIndex = Math.max(i - 1, 0);
                    this.scrollToSuggestion(newIndex);
                    return newIndex;
                });
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
    
    private scrollToSuggestion(index: number) {
        requestAnimationFrame(() => {
            const el = document.getElementById(`suggestion-item-${index}`);
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
            }
        });
    }
    
    updateCursorPosition(): void {
        requestAnimationFrame(() => {
            if (this.inputField?.nativeElement) {
                this.currentCursorIndex.set(this.inputField.nativeElement.selectionStart ?? 0);
                this.inputScrollLeft.set(this.inputField.nativeElement.scrollLeft);
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
        } else if (state.type === 'utility') {
            const lastDollar = textBeforeCursor.lastIndexOf('$');
            if (lastDollar !== -1) {
                const beforeVar = val.substring(0, lastDollar);
                const matchRest = textAfterCursor.match(/^[a-zA-Z0-9_]*/);
                const replaceLen = matchRest ? matchRest[0].length : 0;
                const afterReplaced = textAfterCursor.substring(replaceLen);
                
                const generatedVal = generateUtilityValue(suggestion);
                const newVal = beforeVar + generatedVal + afterReplaced;
                this.value.set(newVal);
                this.onChange(newVal);
                
                const newCursorPos = lastDollar + generatedVal.length;
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
        const scrollLeft = (event.target as HTMLInputElement).scrollLeft;
        if (this.overlayDiv?.nativeElement) {
            this.overlayDiv.nativeElement.scrollLeft = scrollLeft;
        }
        this.inputScrollLeft.set(scrollLeft);
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
                    const varY = rect.bottom;
                    
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
