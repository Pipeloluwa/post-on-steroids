import re

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('isTokenVisible = signal(false);', 'isTokenVisible = signal(false);\n  isRunningEncryptionScript = signal(false);')

run_func_target = r'''async runActiveEncryptionScript\(\) \{'''
run_func_replacement = '''async runActiveEncryptionScript() {
        this.isRunningEncryptionScript.set(true);
        try {'''

content = re.sub(run_func_target, run_func_replacement, content)

run_func_end_target = r'''this\.notificationService\.notify\('Encryption script error: ' \+ result\.error\);\n        \}'''
run_func_end_replacement = '''this.notificationService.notify('Encryption script error: ' + result.error);
        }
        } finally {
            this.isRunningEncryptionScript.set(false);
        }'''
        
content = re.sub(run_func_end_target, run_func_end_replacement, content)

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'w', encoding='utf-8') as f:
    f.write(content)
