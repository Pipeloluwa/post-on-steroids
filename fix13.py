import re

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'r', encoding='utf-8') as f:
    content = f.read()

target = r'''this\.notificationService\.notify\('Encryption script error: ' \+ result\.error\);\n        \}\n      \}'''
replacement = '''this.notificationService.notify('Encryption script error: ' + result.error);
        }
        } finally {
            this.isRunningEncryptionScript.set(false);
        }
      }'''

content = re.sub(target, replacement, content)

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'w', encoding='utf-8') as f:
    f.write(content)
