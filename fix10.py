import re

with open('src/app/shared/services/sandbox.execution.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('.join("\\\\n");', '.join(String.fromCharCode(10));')

with open('src/app/shared/services/sandbox.execution.service.ts', 'w', encoding='utf-8') as f:
    f.write(content)
