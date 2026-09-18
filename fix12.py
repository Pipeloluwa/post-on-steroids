import re

with open('src/app/components/workspace/payload.types.component/payload.types.component.html', 'r', encoding='utf-8') as f:
    content = f.read()

target = r'''<button type="button" \(click\)="runActiveEncryptionScript\(\)"
                    class="flex items-center justify-center bg-\(--postonsteroids-bg-tertiary\) hover:bg-\(--postonsteroids-bg-secondary\) border border-\(--postonsteroids-border\) hover:border-green-500/50 rounded px-3 py-1 transition-colors group cursor-pointer"
                    aria-label="Run encryption script">
                    <span class="text-\[11px\] font-medium text-\(--postonsteroids-text-muted\) group-hover:text-green-500 transition-colors">Run</span>
                </button>'''

replacement = '''<button type="button" (click)="runActiveEncryptionScript()"
                    [disabled]="isRunningEncryptionScript()"
                    class="flex items-center justify-center bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) hover:border-green-500/50 rounded px-3 py-1 transition-colors group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Run encryption script">
                    <span class="text-[11px] font-medium text-(--postonsteroids-text-muted) group-hover:text-green-500 transition-colors">
                        @if (isRunningEncryptionScript()) {
                            Running...
                        } @else {
                            Run
                        }
                    </span>
                </button>'''

content = re.sub(target, replacement, content)

with open('src/app/components/workspace/payload.types.component/payload.types.component.html', 'w', encoding='utf-8') as f:
    f.write(content)
