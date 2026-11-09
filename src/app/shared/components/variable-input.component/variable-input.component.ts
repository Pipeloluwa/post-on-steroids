import { Component, signal, computed, inject, ViewChild, ElementRef, forwardRef, input, output, HostListener, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { VariableService } from '../../services/variable.service';
import { UTILITIES, generateUtilityValue, getUtilityDescription } from '../../utils/utility-variables';

interface TextSegment {
    text: string;
    type: 'normal' | 'global' | 'path' | 'utility';
    key?: string;
}

export interface SuggestionItem {
    id: string;
    label: string;
    insertText: string;
    type: 'utility-dynamic' | 'utility-static' | 'global' | 'path';
    badge: string;
    badgeClass: string;
    description?: string;
    exampleValue?: string;
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
    effectiveType = computed(() => {
        const rawType = this.type();
        if (rawType === 'password') {
            const val = (this.value() || '').trimStart();
            if (val.startsWith('{')) {
                return 'text';
            }
        }
        return rawType;
    });
    
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
    @ViewChild('suggestionContainer') suggestionContainer?: ElementRef<HTMLDivElement>;

    charWidth = 0;
    isMouseInPopup = false;
    hoveredVariable = signal<{ key: string, val: string, type: string, x: number, y: number } | null>(null);

    parsedSegments = computed(() => {
        const val = this.value();
        if (!val) return [];
        if (this.effectiveType() === 'password') {
            return [{ text: val, type: 'normal' as const }];
        }
        
        const regex = /(\{\{.*?\}\}|:[a-zA-Z0-9_-]+|\{[a-zA-Z0-9_-]+\}|\$[a-zA-Z0-9_]+)/g;
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
            } else if (matchText.startsWith('{') && matchText.endsWith('}')) {
                const key = matchText.substring(1, matchText.length - 1).trim();
                const charBefore = match.index > 0 ? val[match.index - 1] : '/';
                if (['/', '?', '&', '='].includes(charBefore)) {
                    segments.push({ text: matchText, type: 'path', key });
                } else {
                    segments.push({ text: matchText, type: 'normal' });
                }
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

    suggestionState = computed<{ type: 'none' | 'global' | 'path' | 'utility'; list: SuggestionItem[] }>(() => {
        if (this.suppressSuggestions()) {
            return { type: 'none', list: [] };
        }
        const val = this.value();
        const cursor = this.currentCursorIndex();
        const textBeforeCursor = val.substring(0, cursor);
        const allVars = this.variableService.variables();
        
        // 1. Double bracket global variables {{
        const lastOpenBracket = textBeforeCursor.lastIndexOf('{{');
        const lastCloseBracket = textBeforeCursor.lastIndexOf('}}');
        if (lastOpenBracket !== -1 && lastOpenBracket >= lastCloseBracket) {
            const searchToken = textBeforeCursor.substring(lastOpenBracket + 2).toLowerCase();
            const globalVars = allVars.filter(v => v.type === 'global' || !v.type);
            const matched = globalVars.filter(v => (v.key || '').toLowerCase().includes(searchToken));
            return {
                type: 'global',
                list: matched.map(v => ({
                    id: `global-${v.key}`,
                    label: v.key,
                    insertText: v.key,
                    type: 'global' as const,
                    badge: 'Variable',
                    badgeClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
                    description: v.value ? `Value: ${v.value}` : '(empty)'
                }))
            };
        }
        
        // 2. Path parameter :
        const lastColon = textBeforeCursor.lastIndexOf(':');
        if (lastColon !== -1) {
            const textAfterColon = textBeforeCursor.substring(lastColon + 1);
            if (/^[a-zA-Z0-9_-]*$/.test(textAfterColon)) {
                const charBeforeColon = lastColon > 0 ? textBeforeCursor[lastColon - 1] : '/';
                if (['/', '?', '&', '='].includes(charBeforeColon)) {
                    const pathVars = allVars.filter(v => v.type === 'path');
                    const matched = pathVars.filter(v => (v.key || '').toLowerCase().includes(textAfterColon.toLowerCase()));
                    return {
                        type: 'path',
                        list: matched.map(v => ({
                            id: `path-${v.key}`,
                            label: v.key,
                            insertText: v.key,
                            type: 'path' as const,
                            badge: 'Path',
                            badgeClass: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
                            description: v.value ? `Value: ${v.value}` : '(empty)'
                        }))
                    };
                }
            }
        }
        
        // 3. Utility variables $
        const lastDollar = textBeforeCursor.lastIndexOf('$');
        if (lastDollar !== -1) {
            const textAfterDollar = textBeforeCursor.substring(lastDollar); // Keep $ for matching
            if (/^\$[a-zA-Z0-9_]*$/.test(textAfterDollar)) {
                const matchedUtils = UTILITIES.filter(k => k.toLowerCase().includes(textAfterDollar.toLowerCase()));
                const list: SuggestionItem[] = [];
                for (const u of matchedUtils) {
                    const example = generateUtilityValue(u);
                    const desc = getUtilityDescription(u);
                    // Dynamic option
                    list.push({
                        id: `dyn-${u}`,
                        label: u,
                        insertText: u,
                        type: 'utility-dynamic' as const,
                        badge: 'Dynamic',
                        badgeClass: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
                        description: `${desc} • Regenerates on each request`
                    });
                    // One-time static option
                    list.push({
                        id: `static-${u}`,
                        label: `${u} (One-time)`,
                        insertText: example,
                        type: 'utility-static' as const,
                        badge: 'One-Time',
                        badgeClass: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
                        exampleValue: example,
                        description: `Value: ${example}`
                    });
                }
                return {
                    type: 'utility',
                    list
                };
            }
        }

        // 4. Single bracket global variables {
        const lastOpenSingle = textBeforeCursor.lastIndexOf('{');
        const lastCloseSingle = textBeforeCursor.lastIndexOf('}');
        if (lastOpenSingle !== -1 && lastOpenSingle >= lastCloseSingle) {
            const searchToken = textBeforeCursor.substring(lastOpenSingle + 1);
            if (/^[a-zA-Z0-9_-]*$/.test(searchToken)) {
                const globalVars = allVars.filter(v => v.type === 'global' || !v.type);
                const matched = globalVars.filter(v => (v.key || '').toLowerCase().includes(searchToken.toLowerCase()));
                return {
                    type: 'global',
                    list: matched.map(v => ({
                        id: `global-${v.key}`,
                        label: v.key,
                        insertText: v.key,
                        type: 'global' as const,
                        badge: 'Variable',
                        badgeClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
                        description: v.value ? `Value: ${v.value}` : '(empty)'
                    }))
                };
            }
        }

        return { type: 'none', list: [] };
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

        const modalWidth = 280;
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

    focus(): void {
        this.inputField?.nativeElement?.focus();
    }

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
        const selStart = inputElement.selectionStart;
        const selEnd = inputElement.selectionEnd;
        this.value.set(newVal);
        this.onChange(newVal);
        this.updateCursorPosition();
        if (selStart !== null && selEnd !== null) {
            requestAnimationFrame(() => {
                if (this.inputField?.nativeElement) {
                    this.inputField.nativeElement.setSelectionRange(selStart, selEnd);
                }
            });
        }
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
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.suppressSuggestions.set(true);
                return;
            }
        }

        if (event.key === 'Enter') {
            this.enter.emit();
        }
    }
    
    private scrollToSuggestion(index: number) {
        requestAnimationFrame(() => {
            const container = this.suggestionContainer?.nativeElement;
            if (!container) return;
            const items = container.querySelectorAll('li');
            const targetItem = items[index];
            if (targetItem) {
                targetItem.scrollIntoView({ block: 'nearest' });
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
    
    setSuggestion(item: SuggestionItem) {
        const val = this.value();
        const cursor = this.currentCursorIndex();
        const state = this.suggestionState();
        if (state.type === 'none') return;
        
        const textBeforeCursor = val.substring(0, cursor);
        const textAfterCursor = val.substring(cursor);
        
        if (state.type === 'global') {
            const lastOpenDouble = textBeforeCursor.lastIndexOf('{{');
            const lastOpenSingle = textBeforeCursor.lastIndexOf('{');
            const lastOpenBracket = lastOpenDouble !== -1 ? lastOpenDouble : lastOpenSingle;
            if (lastOpenBracket !== -1) {
                const beforeVar = val.substring(0, lastOpenBracket);
                const hasClosingDouble = textAfterCursor.startsWith('}}');
                const hasClosingSingle = textAfterCursor.startsWith('}');
                let afterCursor = textAfterCursor;
                if (hasClosingDouble) {
                    afterCursor = textAfterCursor.substring(2);
                } else if (hasClosingSingle) {
                    afterCursor = textAfterCursor.substring(1);
                }
                
                const newVal = beforeVar + '{{' + item.insertText + '}}' + afterCursor;
                this.value.set(newVal);
                this.onChange(newVal);
                
                const newCursorPos = beforeVar.length + 2 + item.insertText.length + 2;
                this.restoreFocus(newCursorPos);
            }
        } else if (state.type === 'path') {
            const lastColon = textBeforeCursor.lastIndexOf(':');
            if (lastColon !== -1) {
                const beforeVar = val.substring(0, lastColon + 1);
                const matchRest = textAfterCursor.match(/^[a-zA-Z0-9_-]*/);
                const replaceLen = matchRest ? matchRest[0].length : 0;
                const afterReplaced = textAfterCursor.substring(replaceLen);
                
                const newVal = beforeVar + item.insertText + afterReplaced;
                this.value.set(newVal);
                this.onChange(newVal);
                
                const newCursorPos = lastColon + 1 + item.insertText.length;
                this.restoreFocus(newCursorPos);
            }
        } else if (state.type === 'utility') {
            const lastDollar = textBeforeCursor.lastIndexOf('$');
            if (lastDollar !== -1) {
                const beforeVar = val.substring(0, lastDollar);
                const matchRest = textAfterCursor.match(/^[a-zA-Z0-9_]*/);
                const replaceLen = matchRest ? matchRest[0].length : 0;
                const afterReplaced = textAfterCursor.substring(replaceLen);
                
                const valToInsert = item.insertText;
                const newVal = beforeVar + valToInsert + afterReplaced;
                this.value.set(newVal);
                this.onChange(newVal);
                
                const newCursorPos = lastDollar + valToInsert.length;
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
        if (this.effectiveType() === 'password') {
            this.hoveredVariable.set(null);
            return;
        }

        if (this.overlayDiv?.nativeElement) {
            const spans = this.overlayDiv.nativeElement.querySelectorAll('span');
            const segments = this.parsedSegments();
            
            let found = false;
            for (let i = 0; i < spans.length; i++) {
                const span = spans[i];
                const seg = segments[i];
                
                if (seg && (seg.type === 'global' || seg.type === 'path')) {
                    const rect = span.getBoundingClientRect();
                    // Check if mouse X is within this exact span's bounds
                    if (event.clientX >= rect.left && event.clientX <= rect.right) {
                        const rawSegKey = (seg.key || '').trim();
                        const cleanSegKey = rawSegKey.replace(/^[:{]+/, '').replace(/[}]+$/, '').trim().toLowerCase();
                        const currentVar = this.variableService.variables().find(
                            v => (v.key || '').replace(/^[:{]+/, '').replace(/[}]+$/, '').trim().toLowerCase() === cleanSegKey
                        );
                        
                        this.hoveredVariable.set({
                            key: rawSegKey.replace(/^[:{]+/, '').replace(/[}]+$/, '').trim(),
                            val: currentVar ? (currentVar.value || '') : '',
                            type: seg.type,
                            x: rect.left + (rect.width / 2),
                            y: rect.bottom
                        });
                        found = true;
                        break;
                    }
                }
            }
            
            if (!found && !this.isMouseInPopup) {
                setTimeout(() => {
                    if (!this.isMouseInPopup) {
                        this.hoveredVariable.set(null);
                    }
                }, 250);
            }
        }
    }

    onMouseLeave() {
        setTimeout(() => {
            if (!this.isMouseInPopup) {
                this.hoveredVariable.set(null);
            }
        }, 250);
    }

    updateVariableValue(key: string, newValue: string) {
        const hover = this.hoveredVariable();
        if (hover && hover.key === key) {
            this.hoveredVariable.set({ ...hover, val: newValue });
        }
        
        const cleanTargetKey = (key || '').replace(/^[:{]+/, '').replace(/[}]+$/, '').trim();
        const lowerTargetKey = cleanTargetKey.toLowerCase();
        const v = this.variableService.variables().find(
            v => (v.key || '').replace(/^[:{]+/, '').replace(/[}]+$/, '').trim().toLowerCase() === lowerTargetKey
        );
        if (v) {
            this.variableService.updateVariable({ ...v, value: newValue });
        } else {
            const type = hover?.type === 'path' ? 'path' : 'global';
            this.variableService.addVariable(cleanTargetKey, newValue, undefined, type);
        }
    }
}
