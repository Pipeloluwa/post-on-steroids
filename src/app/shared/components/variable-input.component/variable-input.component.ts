import { Component, signal, computed, inject, ViewChild, ElementRef, forwardRef, input, output, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { VariableService } from '../../services/variable.service';

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
    
    variableKeys = computed(() => this.variableService.variables().map(v => v.key));
    
    onChange: (val: string) => void = () => {};
    onTouch: () => void = () => {};
    
    enter = output<void>();

    @ViewChild('inputField') inputField!: ElementRef<HTMLInputElement>;
    
    // Autocomplete Logic
    suggestions = computed(() => {
        const val = this.value();
        const cursor = this.currentCursorIndex();
        
        // Find the closest `{{` before the cursor without a closing `}}` in between
        const textBeforeCursor = val.substring(0, cursor);
        const lastOpenBracket = textBeforeCursor.lastIndexOf('{{');
        const lastCloseBracket = textBeforeCursor.lastIndexOf('}}');
        
        if (lastOpenBracket !== -1 && lastOpenBracket >= lastCloseBracket) {
            // We are inside a {{ block!
            const searchToken = textBeforeCursor.substring(lastOpenBracket + 2);
            
            return this.variableKeys().filter(k => k.toLowerCase().includes(searchToken.toLowerCase()));
        }
        
        return [];
    });
    
    cursorOffset = computed(() => {
        const charWidth = 6.5; // Approximate width for font
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
        const inputElement = event.target as HTMLInputElement;
        const newVal = inputElement.value;
        this.value.set(newVal);
        this.onChange(newVal);
        this.updateCursorPosition();
    }
    
    onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            this.enter.emit();
        }
    }
    
    updateCursorPosition(): void {
        // use requestAnimationFrame to ensure the DOM input selection is updated before reading
        requestAnimationFrame(() => {
            if (this.inputField?.nativeElement) {
                this.currentCursorIndex.set(this.inputField.nativeElement.selectionStart ?? 0);
            }
        });
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        if (!this.inputField?.nativeElement.contains(event.target as Node)) {
            // Unfocus sets cursor out, effectively closing dropdown
        }
    }
    
    setSuggestion(suggestion: string) {
        const val = this.value();
        const cursor = this.currentCursorIndex();
        
        const textBeforeCursor = val.substring(0, cursor);
        const textAfterCursor = val.substring(cursor);
        
        const lastOpenBracket = textBeforeCursor.lastIndexOf('{{');
        
        if (lastOpenBracket !== -1) {
            const beforeVar = val.substring(0, lastOpenBracket + 2);
            
            // Check if there are already closing brackets immediately after the cursor
            const hasClosingBrackets = textAfterCursor.startsWith('}}');
            const hasSingleClosingBracket = textAfterCursor.startsWith('}');
            
            let closingStr = '}}';
            if (hasClosingBrackets) {
                closingStr = '';
            } else if (hasSingleClosingBracket) {
                closingStr = '}';
            }
            
            const newVal = beforeVar + suggestion + closingStr + textAfterCursor;
            this.value.set(newVal);
            this.onChange(newVal);
            
            // Restore cursor position after the closing brackets
            const newCursorPos = lastOpenBracket + 2 + suggestion.length + 2;
            requestAnimationFrame(() => {
                if (this.inputField?.nativeElement) {
                    this.inputField.nativeElement.focus();
                    this.inputField.nativeElement.setSelectionRange(newCursorPos, newCursorPos);
                    this.currentCursorIndex.set(newCursorPos);
                }
            });
        }
    }
}
