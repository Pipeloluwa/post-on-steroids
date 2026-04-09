import { Component, signal, computed, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { VariableService } from '../../../shared/services/variable.service';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { effect } from '@angular/core';

@Component({
    selector: 'app-request-url-component',
    imports: [CommonModule, FormsModule, ScrollableSelectComponent, MatIcon],
    templateUrl: './request-url.component.html',
    styleUrl: './request-url.component.css',
})
export class RequestUrlComponent {


    variableService = inject(VariableService);
    tabStateService = inject(TabStateService);
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    selectedMethod = computed(() => this.tabStateService.activeTabState()?.method || 'GET');

    @ViewChild('urlInput') urlInput!: ElementRef<HTMLInputElement>;
    url = signal<string>('');

    constructor() {
        effect(() => {
            const state = this.tabStateService.activeTabState();
            if (state) {
                this.url.set(state.url);
            }
        });
    }

    resolvedUrl = computed(() => this.variableService.resolve(this.url()));


    // Store Variable Suggestions
    variableKeys = computed(() => this.variableService.variables().map(v => v.key));
    currentCursorIndex = signal(0);
    searchVariableToken: string = "";
    keepSecondOpenBracketIndex = 0;

    cursorOffset = computed(() => {
        const charWidth = 5.8; // Approximate width for mono font
        const paddingLeft = 12; // px-3 = 0.75rem = 12px
        const modalWidth = 150; // Width of the suggestions dropdown
        const buffer = 10; // Extra buffer to keep it away from the edge

        let offset = paddingLeft + (this.currentCursorIndex() * charWidth);

        // Prevent the dropdown from going off-screen to the right
        if (this.urlInput?.nativeElement) {
            const containerWidth = this.urlInput.nativeElement.offsetWidth;
            if (containerWidth > 0 && (offset + modalWidth) > containerWidth) {
                // Return a position that pins the modal to the right edge minus buffer
                return Math.max(0, containerWidth - modalWidth - buffer);
            }
        }

        return offset;
    });


    suggestions = computed(() => {
        let urlValue = this.url();
        let cursorIndex = this.currentCursorIndex();

        return urlValue[cursorIndex - 1] === '{' && urlValue[cursorIndex] === '{'
            ? this.variableService.variables().map(v => v.key)

            : this.variableKeys().filter(
                k => {
                    if (
                        urlValue[cursorIndex - 1] === '{'
                        && urlValue[cursorIndex - 2] === '{'
                        && urlValue[cursorIndex] !== '}'
                    ) {
                        this.keepSecondOpenBracketIndex = cursorIndex - 1;

                        this.searchVariableToken = urlValue.substring(this.keepSecondOpenBracketIndex + 1, cursorIndex + 1);
                        return k.toLowerCase().includes(this.searchVariableToken.toLowerCase());
                    }
                    else if (this.searchVariableToken.trim() !== "") {
                        this.searchVariableToken = urlValue.substring(this.keepSecondOpenBracketIndex + 1, cursorIndex + 1);
                        return k.toLowerCase().includes(this.searchVariableToken.toLowerCase())
                    }
                    return false;
                });
    });


    updateCursorPosition(event?: Event): void {
        this.currentCursorIndex.set((this.urlInput.nativeElement.selectionStart ?? 0) - 1);
    }

    onUrlChange(newUrl: string) {
        const id = this.tabStateService.activeTabId();
        if (id) {
            this.tabStateService.updateState(id, { url: newUrl });
        }
    }



    setSuggestion = (suggestion: string) => {
        let cursor = this.currentCursorIndex();
        let affectedSegment = this.url().substring(0, cursor + 1);
        let remainingSegment = this.url().substring(cursor + 1);

        let firstCloseBracketAlreadyExist = this.url()[cursor + 2] === '}';

        let firstUrlSegment = affectedSegment.substring(0, affectedSegment.lastIndexOf('{') + 1);
        firstUrlSegment += `${suggestion}${firstCloseBracketAlreadyExist ? '}' : this.url()[cursor + 2] !== undefined ? "" : '}}'}`;

        let firstCloseBracketIndex = remainingSegment.indexOf('}');
        if (this.url()[cursor + 2] !== undefined) { remainingSegment = remainingSegment.substring(firstCloseBracketIndex > -1 ? firstCloseBracketIndex : 0); }

        const newUrl = `${firstUrlSegment}${remainingSegment}`;
        this.url.set(newUrl);
        const id = this.tabStateService.activeTabId();
        if (id) {
            this.tabStateService.updateState(id, { url: newUrl });
        }

        this.currentCursorIndex.set(-1);
        this.searchVariableToken = "";
        this.keepSecondOpenBracketIndex = 0;
    }

    setMethod(method: string) {
        const id = this.tabStateService.activeTabId();
        if (id) {
            this.tabStateService.updateState(id, { method });
        }
    }

    getMethodColor = (method: string): string => {
        switch (method) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'PATCH': return '#A97BFF';
            case 'DELETE': return '#FF5233';
            case 'HEAD': return '#00BF8E';
            case 'OPTIONS': return '#FF60AD';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }
}
